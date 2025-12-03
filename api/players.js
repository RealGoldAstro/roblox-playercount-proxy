// api/players.js
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
    // Fetch current player count from Roblox
    const response = await fetch('https://games.roblox.com/v1/games?universeIds=8779464785');
    if (!response.ok) {
      throw new Error(`Roblox API failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      res.status(500).json({ error: 'No data', playing: 0 });
      return;
    }

    const currentPlayers = typeof data.data[0].playing === 'number' ? data.data[0].playing : 0;
    
    // Import Upstash Redis client
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const now = Date.now();
    
    // Check if we should save peak data (every 10 minutes)
    const lastSaveTime = await redis.get('lastSaveTime') || 0;
    const timeSinceLastSave = now - lastSaveTime;
    const TEN_MINUTES = 10 * 60 * 1000;

    // Save peak data every 10 minutes
    if (timeSinceLastSave >= TEN_MINUTES || lastSaveTime === 0) {
      // Save current reading with timestamp as score, player count as member
      await redis.zadd('playerPeaks', { score: now, member: `${now}:${currentPlayers}` });
      await redis.set('lastSaveTime', now);
      
      // Cleanup: Remove entries older than 7 days
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
      await redis.zremrangebyscore('playerPeaks', 0, sevenDaysAgo);
    }

    // Calculate peaks from time windows
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    // Get all entries within time windows
    const last24hEntries = await redis.zrange('playerPeaks', twentyFourHoursAgo, now, {
      byScore: true
    });
    
    const last7dEntries = await redis.zrange('playerPeaks', sevenDaysAgo, now, {
      byScore: true
    });
    

    // Extract player counts and find max
    const get24hPeak = () => {
      if (!last24hEntries || last24hEntries.length === 0) return currentPlayers;
      const counts = last24hEntries.map(entry => parseInt(entry.split(':')[1]));
      return Math.max(...counts, currentPlayers);
    };

    const get7dPeak = () => {
      if (!last7dEntries || last7dEntries.length === 0) return currentPlayers;
      const counts = last7dEntries.map(entry => parseInt(entry.split(':')[1]));
      return Math.max(...counts, currentPlayers);
    };

    const peak24h = get24hPeak();
    const peak7d = get7dPeak();

    // Return all data to frontend
    res.status(200).json({
      playing: currentPlayers,
      peak24h: peak24h,
      peak7d: peak7d,
      updatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.warn('⚠️ Failed to fetch player data:', err.message);
    res.status(500).json({
      error: 'Failed to fetch player count',
      playing: 0,
      peak24h: 0,
      peak7d: 0,
    });
  }
}

module.exports = allowCors(handler);
// api/players.js
