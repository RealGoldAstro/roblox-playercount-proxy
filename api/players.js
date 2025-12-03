// api/players.js  -- Location: /api/players.js (Node handler file)

// Simple CORS wrapper so any frontend can call this endpoint safely
const allowCors = (fn) => async (req, res) => {
  // Basic CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    // Preflight request, nothing else to do
    res.status(200).end();
    return;
  }

  // Hand off to main handler
  return fn(req, res);
};

const handler = async (req, res) => {
  let currentPlayers = 0;
  let peak24h = 0;
  let peak7d = 0;

  try {
    // Fetch current player count from Roblox API
    const response = await fetch(
      'https://games.roblox.com/v1/games?universeIds=8779464785'
    );

    if (!response.ok) {
      console.warn('⚠️ Roblox API responded with non-OK status:', response.status);
      throw new Error(`Roblox API failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      console.warn('⚠️ Roblox API returned unexpected structure');
      throw new Error('Invalid Roblox API response structure');
    }

    // Safe extraction of current players
    currentPlayers =
      typeof data.data[0].playing === 'number' ? data.data[0].playing : 0;

    // --- Redis peak tracking with safe fallbacks ---
    try {
      const { Redis } = await import('@upstash/redis');

      // IMPORTANT: these env names must match Vercel settings exactly
      const url = process.env.KV_REST_API_URL;
      const token = process.env.KV_REST_API_TOKEN;

      if (!url || !token) {
        console.warn(
          '⚠️ Upstash Redis env vars missing or empty. KV_REST_API_URL or KV_REST_API_TOKEN not set'
        );
        // Fallback: just use current count for peaks
        peak24h = currentPlayers;
        peak7d = currentPlayers;
      } else {
        // Create Redis client with valid URL + token
        const redis = new Redis({
          url,
          token,
        });

        const now = Date.now();
        const TEN_MINUTES = 10 * 60 * 1000;

        // Get last save time safely
        let lastSaveTime = 0;
        try {
          const savedTime = await redis.get('lastSaveTime');
          lastSaveTime = savedTime ? parseInt(savedTime, 10) : 0;
        } catch (getErr) {
          console.warn(
            '⚠️ Failed to get lastSaveTime from Redis:',
            getErr && getErr.message ? getErr.message : getErr
          );
        }

        const timeSinceLastSave = now - lastSaveTime;

        // Save a new data point every 10 minutes (or first run)
        if (timeSinceLastSave >= TEN_MINUTES || lastSaveTime === 0) {
          try {
            await redis.zadd('playerPeaks', {
              score: now,
              member: `${now}:${currentPlayers}`,
            });
            await redis.set('lastSaveTime', now.toString());
          } catch (saveErr) {
            console.warn(
              '⚠️ Failed to save peak data to Redis:',
              saveErr && saveErr.message ? saveErr.message : saveErr
            );
          }
        }

        const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

        let last24hEntries = [];
        let last7dEntries = [];

        // Fetch last 24h entries
        try {
          last24hEntries =
            (await redis.zrange('playerPeaks', twentyFourHoursAgo, now, {
              byScore: true,
            })) || [];
        } catch (rangeErr) {
          console.warn(
            '⚠️ Failed to fetch 24h peak entries from Redis:',
            rangeErr && rangeErr.message ? rangeErr.message : rangeErr
          );
        }

        // Fetch last 7d entries
        try {
          last7dEntries =
            (await redis.zrange('playerPeaks', sevenDaysAgo, now, {
              byScore: true,
            })) || [];
        } catch (rangeErr) {
          console.warn(
            '⚠️ Failed to fetch 7d peak entries from Redis:',
            rangeErr && rangeErr.message ? rangeErr.message : rangeErr
          );
        }

        const get24hPeak = () => {
          if (!last24hEntries || last24hEntries.length === 0) {
            console.warn('⚠️ No 24h Redis entries found, using currentPlayers as 24h peak');
            return currentPlayers;
          }

          try {
            const counts = last24hEntries
              .map((entry) => {
                const parts = String(entry).split(':');
                return parts.length >= 2 ? parseInt(parts[1], 10) : 0;
              })
              .filter((count) => !isNaN(count) && count > 0);

            if (counts.length === 0) {
              console.warn(
                '⚠️ 24h Redis entries could not be parsed into valid counts, falling back to currentPlayers'
              );
              return currentPlayers;
            }

            return Math.max(...counts, currentPlayers);
          } catch (err) {
            console.warn(
              '⚠️ Failed to parse 24h peak entries:',
              err && err.message ? err.message : err
            );
            return currentPlayers;
          }
        };

        const get7dPeak = () => {
          if (!last7dEntries || last7dEntries.length === 0) {
            console.warn('⚠️ No 7d Redis entries found, using currentPlayers as 7d peak');
            return currentPlayers;
          }

          try {
            const counts = last7dEntries
              .map((entry) => {
                const parts = String(entry).split(':');
                return parts.length >= 2 ? parseInt(parts[1], 10) : 0;
              })
              .filter((count) => !isNaN(count) && count > 0);

            if (counts.length === 0) {
              console.warn(
                '⚠️ 7d Redis entries could not be parsed into valid counts, falling back to currentPlayers'
              );
              return currentPlayers;
            }

            return Math.max(...counts, currentPlayers);
          } catch (err) {
            console.warn(
              '⚠️ Failed to parse 7d peak entries:',
              err && err.message ? err.message : err
            );
            return currentPlayers;
          }
        };

        // Final peak values with fallbacks already handled
        peak24h = get24hPeak();
        peak7d = get7dPeak();
      }
    } catch (redisErr) {
      // Any Redis-level failure (import, network, etc.) falls back to current
      console.warn(
        '⚠️ Redis operations failed completely, using currentPlayers for peaks:',
        redisErr && redisErr.message ? redisErr.message : redisErr
      );
      peak24h = currentPlayers;
      peak7d = currentPlayers;
    }

    // Success response back to client
    res.status(200).json({
      playing: currentPlayers,
      peak24h,
      peak7d,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Top-level catch for Roblox or other unexpected errors
    console.warn(
      '⚠️ Complete /api/players handler failure:',
      err && err.message ? err.message : err
    );

    res.status(500).json({
      error: 'Failed to fetch player count',
      playing: currentPlayers || 0,
      peak24h: peak24h || 0,
      peak7d: peak7d || 0,
    });
  }
};

module.exports = allowCors(handler);

// api/players.js  -- Location: /api/players.js (Node handler file)
