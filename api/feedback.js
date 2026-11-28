// Card ratings from testers (?tester=1 and Prolific links).
// POST saves or updates one rating. GET lists them for the private review page
// (feedback.html) and needs ?key= matching the FEEDBACK_KEY environment variable.
// Stored in one Redis hash, "fb:all": field = rating id, value = JSON.
// Anything older than 12 months is deleted whenever the review page loads (GET).
// DELETE ?key=...&pid=... removes everything saved for one Prolific participant (withdrawal).
// POST with type "consent" saves a Prolific participant's timestamped consent in "fb:consent" (field = Prolific ID).

const REDIS_URL = process.env.HP_KV_REST_API_URL;
const REDIS_TOKEN = process.env.HP_KV_REST_API_TOKEN;
const HASH = 'fb:all';
const CONSENT_HASH = 'fb:consent';
const EXIT_HASH = 'fb:exit';
const KEEP_MS = 365 * 24 * 60 * 60 * 1000; // ratings, consents and exit answers are deleted after 12 months
const REASONS = ['Assumed something', "Doesn't sound like me", 'Too generic', 'Wrong tone', 'Sounds like AI'];
const KINDS = ['new', 'another', 'shorten', 'revise', 'edit'];

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `Redis error: ${r.status}`);
  return data.result;
}

// Reads a hash and deletes entries older than the cutoff. Returns the entries that are kept.
async function readHash(hash, cutoff) {
  const flat = (await redis(['HGETALL', hash])) || [];
  const kept = [], old = [];
  for (let i = 1; i < flat.length; i += 2) {
    let it = null;
    try { it = JSON.parse(flat[i]); } catch (e) { continue; } // skip a bad entry
    if ((it.ts || 0) < cutoff) old.push(flat[i - 1]); else kept.push(it);
  }
  if (old.length) await redis(['HDEL', hash, ...old]);
  return kept;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max, n) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, n).map(x => x.trim().slice(0, max)) : []);

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const key = process.env.FEEDBACK_KEY;
      if (!key || req.query.key !== key) return res.status(401).json({ error: 'Wrong or missing key.' });
      const cutoff = Date.now() - KEEP_MS;
      const items = (await readHash(HASH, cutoff)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      await readHash(CONSENT_HASH, cutoff);
      const exits = await readHash(EXIT_HASH, cutoff);
      return res.status(200).json({ items, exits });
    }

    if (req.method === 'DELETE') {
      const key = process.env.FEEDBACK_KEY;
      if (!key || req.query.key !== key) return res.status(401).json({ error: 'Wrong or missing key.' });
      const pid = str(req.query.pid, 40);
      if (!/^[a-z0-9]{8,40}$/i.test(pid)) return res.status(400).json({ error: 'Enter a Prolific ID.' });
      const flat = (await redis(['HGETALL', HASH])) || [];
      const ids = [];
      for (let i = 1; i < flat.length; i += 2) {
        try { const it = JSON.parse(flat[i]); if (it.prolific && it.prolific.pid === pid) ids.push(flat[i - 1]); } catch (e) {}
      }
      if (ids.length) await redis(['HDEL', HASH, ...ids]);
      const consent = await redis(['HDEL', CONSENT_HASH, pid]);
      const exit = await redis(['HDEL', EXIT_HASH, pid]);
      return res.status(200).json({ success: true, ratings: ids.length, consent: consent || 0, exit: exit || 0 });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = req.body || {};

    // Prolific consent: one timestamped record per Prolific ID, in the hash "fb:consent".
    if (b.type === 'consent') {
      const p = (b.prolific && typeof b.prolific === 'object') ? b.prolific : {};
      const pid = str(p.pid, 40);
      if (!/^[a-z0-9]{8,40}$/i.test(pid)) return res.status(400).json({ error: 'Bad Prolific ID.' });
      const record = {
        pid,
        study: str(p.study, 40),
        session: str(p.session, 40),
        ts: Date.now(),
        code: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7),
      };
      await redis(['HSET', CONSENT_HASH, pid, JSON.stringify(record)]);
      return res.status(200).json({ success: true });
    }

    // Prolific exit answers: one record per Prolific ID, in the hash "fb:exit".
    if (b.type === 'exit') {
      const p = (b.prolific && typeof b.prolific === 'object') ? b.prolific : {};
      const pid = str(p.pid, 40);
      if (!/^[a-z0-9]{8,40}$/i.test(pid)) return res.status(400).json({ error: 'Bad Prolific ID.' });
      const pick = (v, list) => (list.includes(v) ? v : '');
      const cards = (Array.isArray(b.cards) ? b.cards : []).slice(0, 4).map(c => ({
        occasion: str(c && c.occasion, 80),
        send: pick(c && c.send, ['yes', 'maybe', 'no']),
        tried: [...new Set((c && Array.isArray(c.tried) ? c.tried : []).filter(t => ['text', 'copy', 'pdf', 'mail'].includes(t)))],
      }));
      const record = {
        pid,
        study: str(p.study, 40),
        session: str(p.session, 40),
        ts: Date.now(),
        cards,
        vsStore: pick(b.vsStore, ['better', 'same', 'worse']),
        useNext: pick(b.useNext, ['definitely', 'probably', 'probablynot', 'definitelynot']),
        device: pick(b.device, ['phone', 'tablet', 'computer']),
        comment: str(b.comment, 1000),
        code: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7),
      };
      await redis(['HSET', EXIT_HASH, pid, JSON.stringify(record)]);
      return res.status(200).json({ success: true });
    }

    const id = str(b.id, 40);
    if (!/^[a-z0-9]{8,40}$/i.test(id)) return res.status(400).json({ error: 'Bad id.' });
    if (b.rating !== 'up' && b.rating !== 'down') return res.status(400).json({ error: 'Bad rating.' });
    const cardText = str(b.cardText, 4000);
    if (!cardText) return res.status(400).json({ error: 'Card text is required.' });

    const c = (b.choices && typeof b.choices === 'object') ? b.choices : {};
    const item = {
      id,
      ts: Date.now(),
      rating: b.rating,
      reasons: b.rating === 'down' ? strList(b.reasons, 40, 5).filter(r => REASONS.includes(r)) : [],
      note: b.rating === 'down' ? str(b.note, 1000) : '',
      cardText,
      version: Number.isInteger(b.version) ? b.version : null,
      kind: KINDS.includes(b.kind) ? b.kind : '',
      // The sender's choices only. Private free-text answers are never saved here.
      choices: {
        occasion: str(c.occasion, 80),
        relationship: str(c.relationship, 80),
        relationshipChips: strList(c.relationshipChips, 40, 8),
        tones: strList(c.tones, 40, 3),
        toneOther: str(c.toneOther, 120),
        feels: strList(c.feels, 40, 4),
        spirituality: str(c.spirituality, 60),
        detail: str(c.detail, 120),
      },
      source: b.source === 'prolific' ? 'prolific' : 'tester',
      prolific: b.source === 'prolific' ? {
        pid: str(b.prolific && b.prolific.pid, 40),
        study: str(b.prolific && b.prolific.study, 40),
        session: str(b.prolific && b.prolific.session, 40),
      } : null,
      code: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7),
      branch: process.env.VERCEL_GIT_COMMIT_REF || '',
    };

    await redis(['HSET', HASH, id, JSON.stringify(item)]);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('feedback error:', error);
    return res.status(500).json({ error: 'Could not save feedback.' });
  }
};
