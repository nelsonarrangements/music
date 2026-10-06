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
// the nameplate photo as attachments.
//
// Secret required:  wrangler secret put PISTONLINK_CAPTURE_TOKEN
// (must match the token in the iOS/Android apps). It's not a true secret —
// it ships in the app — so CAPTURE_LIMITER (wrangler.toml) also caps each IP
// at a few submissions a minute.
// ---------------------------------------------------------------------------

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const MANUFACTURERS = ['Rodgers', 'Allen', 'Johannus'];
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
  const phone = str(submitter.phone, 40);
  if (!EMAIL_PATTERN.test(email) || phone.replace(/\D/g, '').length < 7) {
    return json({ error: 'A valid email and phone number are required.' }, 400, {});
  }
  const model = str(capture.model) || '(model unknown)';
  const title = `${capture.manufacturer} ${model}`;
  const captured = capture.stops.filter((s) => Array.isArray(s.onMessages) && s.onMessages.length > 0);
  const skipped = capture.stops.filter((s) => s.skipped);
  const checkLabels = { allOn: 'All stops came on', someOn: 'Some stops did not come on', noneOn: 'No stops came on' };
  const verification = capture.verification || {};
  const failed = new Set(verification.failedStopIDs || []);
  const offLabel = verification.offWorked === true ? 'yes' : verification.offWorked === false ? 'no' : 'not run';

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
    '',
    `Name: ${str(submitter.name) || '—'}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Church / location: ${str(submitter.location) || '—'}`,
  ];
  if (str(submitter.notes, 4000)) lines.push('', 'Notes:', str(submitter.notes, 4000));

  lines.push('', 'Stop list:');
  for (const stop of capture.stops) {
    const name = [str(stop.name), str(stop.pipeLength, 20)].filter(Boolean).join(' ');
    const on = (stop.onMessages || []).map((m) => str(m.hex, 600)).join(' | ');
    const status = stop.skipped ? 'SKIPPED' : failed.has(stop.id) ? 'DID NOT COME ON' : '';
    lines.push(`  [${str(stop.division, 20)}] ${name}${status ? ` (${status})` : ''}${on ? `  →  ${on}` : ''}`);
  }

  const photo = typeof capture.nameplatePhotoJPEG === 'string' ? capture.nameplatePhotoJPEG : null;
  const { nameplatePhotoJPEG: _photo, ...captureWithoutPhoto } = capture;
  const safeName = title.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'organ';

  const attachments = [
    { filename: `${safeName} capture.json`, content: base64Utf8(JSON.stringify(captureWithoutPhoto, null, 2)) },
  ];
  if (photo) attachments.push({ filename: `${safeName} nameplate.jpg`, content: photo });

  const resendPayload = {
    from: 'PistonLink <contact@nelsonarrangements.com>',
    to: ['contact@nelsonarrangements.com'],
    subject: `PistonLink — Organ Capture: ${title}`,
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
