// api/players.js - Aggressive CORS

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  return await fn(req, res)
}

const handler = async (req, res) => {
  try {
    const response = await fetch('https://games.roblox.com/v1/games?universeIds=8779464785');

    if (!response.ok) {
      throw new Error(`Roblox API failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      res.status(500).json({ error: 'No data', playing: 0 });
      return;
    }

    const playing = typeof data.data[0].playing === 'number' ? data.data[0].playing : 0;

    res.status(200).json({
      playing,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch player count',
      playing: 0,
    });
  }
}

export default allowCors(handler)
