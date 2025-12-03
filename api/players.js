// api/players.js

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  return await fn(req, res);
};

const handler = async (req, res) => {
  let currentPlayers = 0;
  let peak24h = 0;
  let peak7d = 0;

  try {
    // Fetch current player count from Roblox
    const response = await fetch('https://games.roblox.com/v1/games?universeIds=8779464785');
    if (!response.ok) {
      throw new Error(`Roblox API failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('Invalid Roblox API response structure');
    }

    currentPlayers = typeof data.data[0].playing === 'number' ? data.data[0].playing : 0;

    // Try Redis peak tracking with fallbacks
    try {
      const { Redis } = await import('@upstash/redis');
      const redis = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });

      const now = Date.now();
      const TEN_MINUTES = 10 * 60 * 1000;

      // Check if we should save peak data (every 10 minutes)
      let lastSaveTime = 0;
      try {
        const savedTime = await redis.get('lastSaveTime');
        lastSaveTime = savedTime ? parseInt(savedTime) : 0;
      } catch (getErr) {
        console.warn('⚠️ Failed to get lastSaveTime:', getErr.message);
      }

      const timeSinceLastSave = now - lastSaveTime;

      // Save peak data every 10 minutes
      if (timeSinceLastSave >= TEN_MINUTES || lastSaveTime === 0) {
        try {
          // Save current reading with timestamp as score, player count as member
          await redis.zadd('playerPeaks', { score: now, member: `${now}:${currentPlayers}` });
          await redis.set('lastSaveTime', now.toString());
        } catch (saveErr) {
          console.warn('⚠️ Failed to save peak data:', saveErr.message);
        }
      }

      // Calculate peaks from time windows with fallback
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

      let last24hEntries = [];
      let last7dEntries = [];

      try {
        // Get all entries within time windows using correct Upstash syntax
        last24hEntries = await redis.zrange('playerPeaks', twentyFourHoursAgo, now, {
          byScore: true
        }) || [];
      } catch (rangeErr) {
        console.warn('⚠️ Failed to fetch 24h entries:', rangeErr.message);
      }

      try {
        last7dEntries = await redis.zrange('playerPeaks', sevenDaysAgo, now, {
          byScore: true
        }) || [];
      } catch (rangeErr) {
        console.warn('⚠️ Failed to fetch 7d entries:', rangeErr.message);
      }

      // Extract player counts and find max with validation
      const get24hPeak = () => {
        if (!last24hEntries || last24hEntries.length === 0) return currentPlayers;
        try {
          const counts = last24hEntries
            .map(entry => {
              const parts = String(entry).split(':');
              return parts.length >= 2 ? parseInt(parts[1]) : 0;
            })
            .filter(count => !isNaN(count) && count > 0);
          return counts.length > 0 ? Math.max(...counts, currentPlayers) : currentPlayers;
        } catch (err) {
          console.warn('⚠️ Failed to parse 24h peak:', err.message);
          return currentPlayers;
        }
      };

      const get7dPeak = () => {
        if (!last7dEntries || last7dEntries.length === 0) return currentPlayers;
        try {
          const counts = last7dEntries
            .map(entry => {
              const parts = String(entry).split(':');
              return parts.length >= 2 ? parseInt(parts[1]) : 0;
            })
            .filter(count => !isNaN(count) && count > 0);
          return counts.length > 0 ? Math.max(...counts, currentPlayers) : currentPlayers;
        } catch (err) {
          console.warn('⚠️ Failed to parse 7d peak:', err.message);
          return currentPlayers;
        }
      };

      peak24h = get24hPeak();
      peak7d = get7dPeak();

    } catch (redisErr) {
      // Redis completely failed, fallback to current player count
      console.warn('⚠️ Redis operations failed, using current count as fallback:', redisErr.message);
      peak24h = currentPlayers;
      peak7d = currentPlayers;
    }

    // Return all data to frontend
    res.status(200).json({
      playing: currentPlayers,
      peak24h: peak24h,
      peak7d: peak7d,
      updatedAt: new Date().toISOString(),
    });

  } catch (err) {
    // Complete failure - return zeros or last known values
    console.warn('⚠️ Complete API failure:', err.message);
    res.status(500).json({
      error: 'Failed to fetch player count',
      playing: currentPlayers || 0,
      peak24h: peak24h || 0,
      peak7d: peak7d || 0,
    });
  }
};

module.exports = allowCors(handler);
// api/players.js
