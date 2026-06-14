module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Card ID is required.' });
  }

  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    const redisRes = await fetch(`${url}/get/card:${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await redisRes.json();
    console.log('get-card response:', JSON.stringify(data));

    if (!data.result) {
      return res.status(404).json({ error: 'Card not found or expired.' });
    }

    const card = typeof data.result === 'string' 
      ? JSON.parse(data.result) 
      : data.result;

    return res.status(200).json(card);

  } catch (error) {
    console.error('Get card error:', error);
    return res.status(500).json({ error: 'Failed to retrieve card.' });
  }
};
