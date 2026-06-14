const { randomBytes } = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cardText, headerId, themeId, occasion, senderName } = req.body;

  if (!cardText) {
    return res.status(400).json({ error: 'Card text is required.' });
  }

  try {
    const id = randomBytes(4).toString('hex');

    const cardData = {
      cardText,
      headerId:   headerId   || null,
      themeId:    themeId    || 'warm',
      occasion:   occasion   || '',
      senderName: senderName || '',
      createdAt:  Date.now(),
    };

    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    // Use direct SET with EX via Upstash REST API
    const redisRes = await fetch(`${url}/set/card:${id}?EX=7776000`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cardData),
    });

    const redisData = await redisRes.json();
    console.log('save-card redis response:', JSON.stringify(redisData));

    if (!redisRes.ok) {
      throw new Error(`Redis error: ${redisRes.status}`);
    }

    const cardUrl = `https://heartpenned.com/card.html?id=${id}`;
    return res.status(200).json({ success: true, id, url: cardUrl });

  } catch (error) {
    console.error('Save card error:', error);
    return res.status(500).json({ error: 'Failed to save card. Please try again.' });
  }
};
