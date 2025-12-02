// api/players.js

export default async function handler(req, res) {
  try {
    const response = await fetch('https://games.roblox.com/v1/games?universeIds=8779464785');

    if (!response.ok) {
      throw new Error(`Roblox API failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      return res.status(500).json({ error: 'No data', playing: 0 });
    }

    const playing = typeof data.data[0].playing === 'number' ? data.data[0].playing : 0;

    return res.status(200).json({
      playing,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to fetch player count',
      playing: 0,
    });
  }
}
