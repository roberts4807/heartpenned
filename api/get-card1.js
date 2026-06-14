async function redisGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([['GET', key]]),
  });

  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  const data = await res.json();
  // Pipeline returns array of results
  const result = data[0]?.result;
  return result ? JSON.parse(result) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Card ID is required.' });
  }

  try {
    const card = await redisGet(`card:${id}`);

    if (!card) {
      return res.status(404).json({ error: 'Card not found or expired.' });
    }

    return res.status(200).json(card);
  } catch (error) {
    console.error('Get card error:', error);
    return res.status(500).json({ error: 'Failed to retrieve card.' });
  }
};
