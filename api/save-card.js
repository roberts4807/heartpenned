const { randomBytes } = require('crypto');

// Upstash Redis REST API helper
async function redisSet(key, value, exSeconds) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const body = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, JSON.stringify(value)];

  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([body]),
  });

  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cardText, headerId, themeId, occasion, senderName } = req.body;

  if (!cardText) {
    return res.status(400).json({ error: 'Card text is required.' });
  }

  try {
    // Generate unique 8-char ID
    const id = randomBytes(4).toString('hex');

    const cardData = {
      cardText,
      headerId:   headerId   || null,
      themeId:    themeId    || 'warm',
      occasion:   occasion   || '',
      senderName: senderName || '',
      createdAt:  Date.now(),
    };

    // Store for 90 days (7,776,000 seconds)
    await redisSet(`card:${id}`, cardData, 7776000);

    const cardUrl = `https://heartpenned.com/card.html?id=${id}`;

    return res.status(200).json({ success: true, id, url: cardUrl });
  } catch (error) {
    console.error('Save card error:', error);
    return res.status(500).json({ error: 'Failed to save card. Please try again.' });
  }
};
