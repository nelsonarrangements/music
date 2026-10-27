/**
 * Cloudflare Worker — Contact form handler
 *
 * Deploy with Wrangler:
 *   npm i -g wrangler
 *   wrangler login
 *   wrangler deploy worker/contact.js --name nelson-contact --compatibility-date 2024-01-01
 *
 * Then add your secret:
 *   wrangler secret put RESEND_API_KEY
 *   (paste your Resend API key when prompted)
 *
 * The Worker URL (e.g. https://nelson-contact.<your-subdomain>.workers.dev)
 * goes into CONTACT_ENDPOINT in contact.html.
 *
 * Resend must have nelsonarrangements.com verified before this will send.
 */

const ALLOWED_ORIGINS = [
  'https://nelsonarrangements.com',
  'https://www.nelsonarrangements.com',
];

export default {
  async fetch(request, env) {
    // PistonLink "Catalog Your Organ" submissions come from the iOS/Android
    // app, not a browser — no Origin, no Turnstile — so they get their own
    // route with its own checks instead of the contact form's.
    if (new URL(request.url).pathname === '/organ-capture') {
      return handleOrganCapture(request, env);
    }

    // In-app feedback (bug reports, suggestions, optional screenshot) from the PistonLink apps.
    if (new URL(request.url).pathname === '/feedback') {
      return handleFeedback(request, env);
    }

    // The PistonLink Community Worker tells this one to email a notice when someone submits a
    // registration. It reaches us over a service binding and proves itself with a shared token.
    if (new URL(request.url).pathname === '/community-notify') {
      return handleCommunityNotify(request, env);
    }

    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Reject requests from origins not in the allowlist
    if (!allowed) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, corsHeaders);
    }

    const { name, email, type, hymn, event: eventDetail, message, _hp, 'cf-turnstile-response': turnstileToken } = data;

    // Honeypot — bots fill hidden fields, humans don't
    if (_hp) {
      return json({ success: true }, 200, corsHeaders); // silently discard
    }

    // Verify Cloudflare Turnstile token
    if (!turnstileToken) {
      return json({ error: 'Bot verification token missing.' }, 400, corsHeaders);
    }
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken }),
    });
    const tsData = await tsRes.json();
    if (!tsData.success) {
      return json({ error: 'Bot verification failed. Please try again.' }, 400, corsHeaders);
    }

    if (!name?.trim() || !email?.trim() || !type?.trim()) {
      return json({ error: 'Name, email, and inquiry type are required.' }, 400, corsHeaders);
    }

    // Build plain-text email body
    let emailText = `Name: ${name}\nEmail: ${email}\nInquiry Type: ${type}`;
    if (hymn?.trim())        emailText += `\nHymn / Piece: ${hymn}`;
    if (eventDetail?.trim()) emailText += `\nEvent / Audience: ${eventDetail}`;
    if (message?.trim())     emailText += `\n\n${message}`;

    const resendPayload = {
      from: 'Nelson Arrangements <contact@nelsonarrangements.com>',
      to:   ['contact@nelsonarrangements.com'],
      reply_to: email,
      subject: `Nelson Arrangements — ${type}`,
      text: emailText,
    };

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('Resend error:', err);
      return json({ error: 'Failed to send message. Please try again.' }, 502, corsHeaders);
    }

    return json({ success: true }, 200, corsHeaders);
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// ---------------------------------------------------------------------------
// PistonLink organ capture
//
// The app POSTs the whole capture session as JSON. This validates it, then
// emails it to contact@ via Resend with the capture JSON (minus the photo) and
// the nameplate and lit-console photos as attachments.
//
// Secret required:  wrangler secret put PISTONLINK_CAPTURE_TOKEN
// (must match the token in the iOS/Android apps). It's not a true secret —
// it ships in the app — so CAPTURE_LIMITER (wrangler.toml) also caps each IP
// at a few submissions a minute.
// ---------------------------------------------------------------------------

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
// Must list every maker the apps' Catalog wizard offers (OrganManufacturer), or that capture is rejected.
const MANUFACTURERS = ['Rodgers', 'Allen', 'Johannus', 'Viscount'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleOrganCapture(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, {});
  }
  if (!env.PISTONLINK_CAPTURE_TOKEN || request.headers.get('X-PistonLink-Token') !== env.PISTONLINK_CAPTURE_TOKEN) {
    return json({ error: 'Not authorized.' }, 401, {});
  }

  if (env.CAPTURE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.CAPTURE_LIMITER.limit({ key: ip });
    if (!success) {
      return json({ error: 'Too many submissions — please wait a minute and try again.' }, 429, {});
    }
  }

  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_CAPTURE_BYTES) {
    return json({ error: 'Capture is too large to send.' }, 413, {});
  }

  const raw = await request.text();
  if (raw.length > MAX_CAPTURE_BYTES) {
    return json({ error: 'Capture is too large to send.' }, 413, {});
  }

  let capture;
  try {
    capture = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid capture.' }, 400, {});
  }

  if (capture?.schemaVersion !== 1 || !MANUFACTURERS.includes(capture.manufacturer) || !Array.isArray(capture.stops)) {
    return json({ error: 'Invalid capture.' }, 400, {});
  }
  if (capture.stops.length > 400) {
    return json({ error: 'Invalid capture.' }, 400, {});
  }

  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const submitter = capture.submitter || {};
  const email = str(submitter.email);
  if (!EMAIL_PATTERN.test(email)) {
    return json({ error: 'A valid email is required.' }, 400, {});
  }
  const model = str(capture.model) || '(model unknown)';
  const title = `${capture.manufacturer} ${model}`;
  const captured = capture.stops.filter((s) => Array.isArray(s.onMessages) && s.onMessages.length > 0);
  const skipped = capture.stops.filter((s) => s.skipped);
  const checkLabels = { allOn: 'All stops came on', someOn: 'Some stops did not come on', noneOn: 'No stops came on' };
  const verification = capture.verification || {};
  const failed = new Set(verification.failedStopIDs || []);
  const offLabel = verification.offWorked === true ? 'yes' : verification.offWorked === false ? 'no' : 'not run';

  const encore = capture.encoreTest || {};
  const encoreLabels = {
    heardAll: 'Heard the full chord',
    heardSome: 'Heard only part of it',
    heardNothing: 'Heard nothing',
    skipped: 'Skipped',
  };
  const encoreChannels = Object.entries(encore.channels || {})
    .filter(([, ch]) => Number.isInteger(ch))
    .map(([division, ch]) => `${str(division, 20)} ${ch}`)
    .join(', ');

  // Rodgers Voice Palette / Allen second-voice tab: those codes aren't in the capture, so a yes means a follow-up.
  const altVoices = capture.hasAlternateVoices;
  const altVoicesLabel = altVoices === true ? 'YES — follow up by email for the alternate-voice codes' : altVoices === false ? 'no' : 'not answered';

  const lines = [
    `Organ: ${title}`,
    `Serial number: ${str(capture.serialNumber) || '—'}`,
    `Manuals: ${capture.manualCount ?? '—'}`,
    `General pistons: ${capture.generalPistonCount ?? '—'}`,
    `Detected MIDI: ${str(capture.detectedProtocol) || '—'}`,
    `MIDI sources: ${(capture.midiSourceNames || []).map((n) => str(n)).join(', ') || '—'}`,
    `App version: ${str(capture.appVersion) || '—'}`,
    '',
    `Stops: ${captured.length} captured, ${skipped.length} skipped, ${capture.stops.length} total`,
    `Send-back check: ${checkLabels[verification.result] || 'not run'}`,
    `Off codes worked: ${offLabel}`,
    `Encore test: ${encoreLabels[encore.result] || 'not run'}`,
    `Keyboard MIDI channels: ${encoreChannels || '—'}`,
    `Alternate voices: ${altVoicesLabel}`,
    '',
    `Email: ${email}`,
  ];

  lines.push('', 'Stop list:');
  for (const stop of capture.stops) {
    const name = [str(stop.name), str(stop.pipeLength, 20)].filter(Boolean).join(' ');
    const on = (stop.onMessages || []).map((m) => str(m.hex, 600)).join(' | ');
    const status = stop.skipped ? 'SKIPPED' : failed.has(stop.id) ? 'DID NOT COME ON' : '';
    lines.push(`  [${str(stop.division, 20)}] ${name}${status ? ` (${status})` : ''}${on ? `  →  ${on}` : ''}`);
  }

  const photo = typeof capture.nameplatePhotoJPEG === 'string' ? capture.nameplatePhotoJPEG : null;
  const litPhotos = Array.isArray(capture.litConsolePhotosJPEG)
    ? capture.litConsolePhotosJPEG.filter((p) => typeof p === 'string').slice(0, 3)
    : [];
  const { nameplatePhotoJPEG: _photo, litConsolePhotosJPEG: _litPhotos, ...captureWithoutPhoto } = capture;
  const safeName = title.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'organ';

  const attachments = [
    { filename: `${safeName} capture.json`, content: base64Utf8(JSON.stringify(captureWithoutPhoto, null, 2)) },
  ];
  if (photo) attachments.push({ filename: `${safeName} nameplate.jpg`, content: photo });
  litPhotos.forEach((content, i) => attachments.push({ filename: `${safeName} lit console ${i + 1}.jpg`, content }));
  lines.push('', `Lit-console photos: ${litPhotos.length}`);

  const resendPayload = {
    from: 'PistonLink <contact@nelsonarrangements.com>',
    to: ['contact@nelsonarrangements.com'],
    subject: `PistonLink — Organ Capture: ${title}${altVoices === true ? ' (alternate voices: follow up)' : ''}`,
    text: lines.join('\n'),
    attachments,
  };
  resendPayload.reply_to = email;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resendPayload),
  });

  if (!resendRes.ok) {
    console.error('Resend error (organ capture):', await resendRes.text());
    return json({ error: "PistonLink couldn't send this right now. Your capture is saved — try again later." }, 502, {});
  }

  await sendCaptureThanks(env, email, title);
  return json({ success: true }, 200, {});
}

// Best-effort thank-you to the submitter; a failure here never fails the capture itself.
async function sendCaptureThanks(env, email, title) {
  const organ = title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const text = [
    'Thank you for cataloging your organ with PistonLink.',
    '',
    `We received your capture for the ${organ}. Here is what happens next:`,
    '',
    '1. Review. I read through the MIDI codes your organ sent for each stop, and check them against your photos and the send-back test you ran.',
    '2. Follow-up. If anything looks unclear, I will write to you at this address before adding the organ.',
    '3. Adding your organ. Once the capture checks out, the organ is built into PistonLink as a fully supported model.',
    '4. Release. It ships in a future app update. This usually takes a couple of weeks, though a busy stretch can make it longer.',
    '',
    'In the meantime, your organ keeps working in the Console and Deploy as a temporary organ, so you can use PistonLink with it right away. When the update arrives, PistonLink moves you to the supported model.',
    '',
    'You do not need to do anything else. If you want to add to your submission or have a question, just reply to this email.',
    '',
    'Thank you for helping other organists,',
    'Garrett Nelson',
    'PistonLink',
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'PistonLink <contact@nelsonarrangements.com>',
        to: [email],
        reply_to: 'contact@nelsonarrangements.com',
        subject: 'Thanks for cataloging your organ with PistonLink',
        text,
      }),
    });
    if (!res.ok) console.error('Resend error (capture thank-you):', await res.text());
  } catch (err) {
    console.error('Capture thank-you failed:', err);
  }
}

// ---------------------------------------------------------------------------
// PistonLink in-app feedback
//
// The app POSTs { message, category, email, platform, appVersion, osVersion, device,
// screenshotJPEG? } as JSON. Same shared token and per-IP limiter as the organ-capture route.
// Emails contact@ via Resend; the optional screenshot rides along as an attachment, and
// reply_to is the sender's email (required, so there is always someone to answer).
// ---------------------------------------------------------------------------

const MAX_FEEDBACK_BYTES = 6 * 1024 * 1024;
const FEEDBACK_CATEGORIES = { bug: 'Bug', suggestion: 'Suggestion', other: 'Other' };

async function handleFeedback(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, {});
  }
  if (!env.PISTONLINK_CAPTURE_TOKEN || request.headers.get('X-PistonLink-Token') !== env.PISTONLINK_CAPTURE_TOKEN) {
    return json({ error: 'Not authorized.' }, 401, {});
  }

  if (env.CAPTURE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.CAPTURE_LIMITER.limit({ key: ip });
    if (!success) {
      return json({ error: 'Too many submissions — please wait a minute and try again.' }, 429, {});
    }
  }

  if (Number(request.headers.get('Content-Length') || 0) > MAX_FEEDBACK_BYTES) {
    return json({ error: 'That is too large to send. Try a smaller screenshot.' }, 413, {});
  }
  const raw = await request.text();
  if (raw.length > MAX_FEEDBACK_BYTES) {
    return json({ error: 'That is too large to send. Try a smaller screenshot.' }, 413, {});
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid feedback.' }, 400, {});
  }

  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const message = str(body?.message, 4000);
  if (!message) {
    return json({ error: 'Please write a message first.' }, 400, {});
  }
  const category = FEEDBACK_CATEGORIES[str(body.category, 20)] || 'Other';
  const email = str(body.email);
  if (!EMAIL_PATTERN.test(email)) {
    return json({ error: 'A valid email is required so we can reply.' }, 400, {});
  }
  const platform = str(body.platform, 20) || '—';

  const lines = [
    `Category: ${category}`,
    `Platform: ${platform}`,
    `App version: ${str(body.appVersion, 40) || '—'}`,
    `OS: ${str(body.osVersion, 60) || '—'}`,
    `Device: ${str(body.device, 80) || '—'}`,
    `Reply to: ${email}`,
    '',
    message,
  ];

  const screenshot = typeof body.screenshotJPEG === 'string' ? body.screenshotJPEG : null;
  const payload = {
    from: 'PistonLink <contact@nelsonarrangements.com>',
    to: ['contact@nelsonarrangements.com'],
    subject: `PistonLink — Feedback (${category}, ${platform}): ${message.replace(/\s+/g, ' ').slice(0, 60)}`,
    text: lines.join('\n'),
  };
  payload.reply_to = email;
  if (screenshot) payload.attachments = [{ filename: 'screenshot.jpg', content: screenshot }];

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error('Resend error (feedback):', await res.text());
    return json({ error: "PistonLink couldn't send this right now. Please try again later." }, 502, {});
  }
  return json({ success: true }, 200, {});
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// PistonLink Community: "someone submitted a registration" notice
//
// Called by the pistonlink-community Worker right after it stores a new pending submission, so the
// moderator knows to open the review panel. Best effort on the caller's side: a failure here never
// affects the submission.
//
// Secret required:  wrangler secret put COMMUNITY_NOTIFY_TOKEN  (same value as on pistonlink-community)
// ---------------------------------------------------------------------------

async function handleCommunityNotify(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, {});
  }
  const token = request.headers.get('X-Community-Notify-Token');
  if (!env.COMMUNITY_NOTIFY_TOKEN || !token || token !== env.COMMUNITY_NOTIFY_TOKEN) {
    return json({ error: 'Not authorized.' }, 401, {});
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid notice.' }, 400, {});
  }

  const clean = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
  const hymn = `#${Number.isInteger(body.hymnNumber) ? body.hymnNumber : '?'} ${clean(body.hymnTitle)}`.trim();
  const lines = [
    'Someone submitted a registration to the PistonLink Community.',
    '',
    `Hymn: ${hymn}`,
    `Name: ${clean(body.label) || '—'}`,
    `Built for: ${clean(body.organ, 40) || '—'}`,
    `Shared by: ${clean(body.displayName, 30) || 'Anonymous'}`,
    `Verses: ${Number.isInteger(body.verseCount) ? body.verseCount : '—'}`,
    '',
    'It stays hidden until you approve it. Open Registration Approvals and check the Pending tab:',
    'http://127.0.0.1:8787',
  ];

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'PistonLink <contact@nelsonarrangements.com>',
      to: ['contact@nelsonarrangements.com'],
      subject: `PistonLink Community: new registration (${hymn})`.slice(0, 200),
      text: lines.join('\n'),
    }),
  });

  if (!res.ok) {
    console.error('Resend error (community notify):', await res.text());
    return json({ error: 'Could not send the notice.' }, 502, {});
  }
  return json({ success: true }, 200, {});
}
