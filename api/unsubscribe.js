const { createHmac, timingSafeEqual } = require('crypto');

const REDIS_URL = process.env.HP_KV_REST_API_URL;
const REDIS_TOKEN = process.env.HP_KV_REST_API_TOKEN;

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

function validToken(email, token) {
  const expected = createHmac('sha256', process.env.RESEND_API_KEY || '').update(email).digest('hex').slice(0, 32);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:60px 20px;background:#f4f4f4;font-family:Georgia,serif;color:#2d2d2d;text-align:center;">
<div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #e8e8e8;border-radius:16px;padding:40px 32px;">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#999;">HeartPenned</p>
${body}
</div></body></html>`;
}

module.exports = async function handler(req, res) {
  const email = String(req.query.e || '').toLowerCase().trim();
  const token = req.query.t;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!email || !validToken(email, token)) {
    return res.status(400).send(page('Link not valid', '<h1 style="font-size:22px;font-weight:normal;">This unsubscribe link isn\'t valid.</h1>'));
  }

  // GET shows a confirm button (email scanners sometimes open links automatically).
  if (req.method === 'GET') {
    return res.status(200).send(page('Unsubscribe',
      `<h1 style="font-size:22px;font-weight:normal;margin:0 0 16px;">Stop receiving cards?</h1>
<p style="font-size:15px;line-height:1.7;color:#555;margin:0 0 24px;">${escapeHtml(email)} will no longer receive cards sent through HeartPenned.</p>
<form method="POST"><button type="submit" style="background:#4C51BF;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:15px;cursor:pointer;">Unsubscribe</button></form>`));
  }

  if (req.method === 'POST') {
    try {
      await redis(['SET', `unsub:${email}`, '1']);
      return res.status(200).send(page('Unsubscribed',
        '<h1 style="font-size:22px;font-weight:normal;margin:0 0 16px;">You\'re unsubscribed.</h1><p style="font-size:15px;color:#555;margin:0;">You won\'t receive any more cards sent through HeartPenned.</p>'));
    } catch (e) {
      console.error('Unsubscribe error:', e);
      return res.status(500).send(page('Error', '<h1 style="font-size:22px;font-weight:normal;">Something went wrong. Please try again.</h1>'));
    }
  }

  return res.status(405).send(page('Not allowed', ''));
};
