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
  // remove the line below before going to production:
  'http://localhost:5174',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

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

    const { name, email, type, hymn, event: eventDetail, message } = data;

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
