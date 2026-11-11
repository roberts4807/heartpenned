// ---------- Shared guard helpers (Redis rate limits + owner alerts) ----------
const REDIS_URL = process.env.HP_KV_REST_API_URL;
const REDIS_TOKEN = process.env.HP_KV_REST_API_TOKEN;
const ALERT_TO = process.env.ALERT_EMAIL || 'roberts4807@gmail.com';
let lastLocalAlert = 0;

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

// Returns true if the action is allowed. Fails open if Redis is unreachable.
async function allow(key, limit, windowSec) {
  try {
    const n = await redis(['INCR', key]);
    if (n === 1) await redis(['EXPIRE', key, windowSec]);
    return n <= limit;
  } catch (e) {
    console.error('Rate limit check failed:', e);
    alertOwner('Redis unreachable', String(e));
    return true;
  }
}

// Emails the owner, at most once per hour per alert type.
async function alertOwner(subject, detail) {
  try {
    let shouldSend = true;
    try {
      const ok = await redis(['SET', `alert:${subject}`, '1', 'EX', 3600, 'NX']);
      shouldSend = ok === 'OK';
    } catch {
      shouldSend = Date.now() - lastLocalAlert > 3600 * 1000;
    }
    if (!shouldSend) return;
    lastLocalAlert = Date.now();
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'HeartPenned Alerts <hello@heartpenned.com>',
        to: [ALERT_TO],
        subject: `HeartPenned alert: ${subject}`,
        text: `${subject}\n\n${detail}\n\nTime: ${new Date().toISOString()}`,
      }),
    });
  } catch (e) {
    console.error('Alert email failed:', e);
  }
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}
function today() { return new Date().toISOString().slice(0, 10); }
// ---------------------------------------------------------------------------

const PER_IP_PER_DAY = 50;      // generations (new cards, revisions, versions, shorten)
const GLOBAL_PER_DAY = 500;     // emergency brake for the whole site
const MAX_PROMPT_CHARS = 25000;

const BUSY_MSG = "HeartPenned is getting a lot of love right now. Please try again in a little while.";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: 'That request is too long. Please shorten your answers and try again.' });
  }

  const ip = clientIp(req);
  if (!(await allow(`rl:gen:ip:${ip}:${today()}`, PER_IP_PER_DAY, 86400))) {
    return res.status(429).json({ error: "You've written a lot of cards today! Please come back tomorrow to write more." });
  }
  if (!(await allow(`rl:gen:global:${today()}`, GLOBAL_PER_DAY, 172800))) {
    alertOwner('Daily generation limit reached', `The site-wide cap of ${GLOBAL_PER_DAY} generations per day was hit.`);
    return res.status(429).json({ error: BUSY_MSG });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('Anthropic error:', data.error);
      await alertOwner('Card generation failing', `Status ${response.status}: ${data.error.type || ''} ${data.error.message || ''}`);
      return res.status(503).json({ error: BUSY_MSG });
    }

    const text = data.content?.find(b => b.type === 'text')?.text || '';
    res.status(200).json({ text });
  } catch (e) {
    console.error('Generate error:', e);
    await alertOwner('Card generation failing', String(e));
    return res.status(503).json({ error: BUSY_MSG });
  }
}
