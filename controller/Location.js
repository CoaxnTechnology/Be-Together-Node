// controllers/locationController.js
const User = require("../model/User"); // adjust path if your project uses ../model/User

function haversineDistance(lat1, lon1, lat2, lon2) {
  function toRad(x) { return x * Math.PI / 180; }
  const R = 6371000; // metres
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

const ALLOWED_PROVIDERS = new Set(['gps','network','wifi','cell','fused','passive','mock', null]);

// Configuration
const EXPIRE_DAYS = 7;             // threshold to consider a location stale
const CLEANUP_COOLDOWN_MS = 1000 * 60 * 60; // 1 hour between cleanup runs per process

// keep last cleanup time in memory so we don't run updateMany on every request
if (!global.__lastLocationCleanupAt) global.__lastLocationCleanupAt = 0;

async function expireStaleLocationsIfNeeded() {
  try {
    const now = Date.now();
    if (now - global.__lastLocationCleanupAt < CLEANUP_COOLDOWN_MS) return; // recently cleaned up

    global.__lastLocationCleanupAt = now; // mark now (prevents parallel callers)

    const cutoff = new Date(Date.now() - EXPIRE_DAYS * 24 * 60 * 60 * 1000);

    // Update users where recordedAt < cutoff: set coords to [0,0], null recordedAt, mark updatedAt
    // Optional: set a flag 'location_stale': true for auditing
    const update = {
      $set: {
        "lastLocation.coords.coordinates": [0, 0],
        "lastLocation.recordedAt": null,
        "lastLocation.updatedAt": new Date(),
        location_stale: true,
        updated_at: new Date()
      }
    };

    // Only run the update if there are any matches - but updateMany returns modified count anyway.
    const res = await User.updateMany(
      { "lastLocation.recordedAt": { $lt: cutoff } },
      update
    );

    // optional: log results (use your logger)
    console.info(`expireStaleLocationsIfNeeded: matched=${res.matchedCount ?? res.n ?? 0} modified=${res.modifiedCount ?? res.nModified ?? 0}`);
  } catch (err) {
    // don't throw to caller — just log and continue
    console.error("expireStaleLocationsIfNeeded error:", err);
  }
}

exports.location = async (req, res) => {
  try {
    // run cleanup opportunistically (non-blocking for correctness but awaited so it finishes sometimes)
    // This will run at most once per CLEANUP_COOLDOWN_MS per process.
    // If you prefer, you can run this asynchronously (without await), but awaiting avoids overlapping heavy ops.
    await expireStaleLocationsIfNeeded();

    const { userId, latitude, longitude, accuracy, provider, recordedAt } = req.body;
    const userIdToken = req.user && req.user.id;

    if (!userIdToken) return res.status(401).json({ error: 'Unauthorized' });
    if (String(userId) !== String(userIdToken)) return res.status(403).json({ error: 'Forbidden' });

    // numeric conversion + basic validation
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'latitude and longitude must be numbers' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'invalid coordinates' });
    }

    // If client sends 0,0 -> keep previous location and return it (no DB update)
    if (lat === 0 && lng === 0) {
      try {
        const existing = await User.findById(userId).select('lastLocation').lean();
        return res.status(200).json({
          ok: true,
          lastLocation: existing ? existing.lastLocation : null,
          message: 'kept previous location'
        });
      } catch (readErr) {
        console.error('failed to read previous location for 0,0 fallback', readErr);
        return res.status(500).json({ error: 'server error' });
      }
    }

    // provider optional validation
    if (provider !== undefined && !ALLOWED_PROVIDERS.has(provider)) {
      console.warn(`Unknown provider "${provider}" from user ${userId}`);
    }

    // recordedAt sanity checks
    const recAt = recordedAt ? new Date(recordedAt) : new Date();
    if (isNaN(recAt.getTime())) return res.status(400).json({ error: 'invalid recordedAt' });

    const now = new Date();
    const MAX_FUTURE_MS = 1000 * 60 * 5; // allow 5 minutes into future
    const MAX_PAST_MS = 1000 * 60 * 60 * 24 * 30; // allow up to 30 days old (tunable)
    if (recAt - now > MAX_FUTURE_MS) return res.status(400).json({ error: 'recordedAt is in the near future' });
    if (now - recAt > MAX_PAST_MS) return res.status(400).json({ error: 'recordedAt too old' });

    // Read current lastLocation (lean) so we can compute distance threshold
    const user = await User.findById(userId).select('lastLocation').lean();
    const MIN_MOVE_METERS = 20; // your threshold
    let shouldUpdate = true;

    if (user && user.lastLocation && user.lastLocation.recordedAt) {
      const oldCoords = user.lastLocation.coords && user.lastLocation.coords.coordinates;
      if (oldCoords && oldCoords.length === 2) {
        const [oldLng, oldLat] = oldCoords;
        const dist = haversineDistance(oldLat, oldLng, lat, lng);
        if (dist < MIN_MOVE_METERS) shouldUpdate = false;
      }
    }

    if (!shouldUpdate) {
      return res.status(200).json({ ok: true, message: 'Location too close to previous, skipped' });
    }

    // Prepare new lastLocation fields
    const newLoc = {
      'lastLocation.coords': { type: 'Point', coordinates: [lng, lat] },
      'lastLocation.accuracy': (accuracy == null) ? null : Number(accuracy),
      'lastLocation.provider': provider || null,
      'lastLocation.recordedAt': recAt,
      'lastLocation.updatedAt': new Date()
    };

    // Also update lastActive if you have that field on schema
    newLoc.lastActive = new Date();

    // Atomic conditional update: only update if incoming recordedAt is newer than stored one (or stored is missing)
    const filter = {
      _id: userId,
      $or: [
        { 'lastLocation.recordedAt': { $lt: recAt } },
        { 'lastLocation.recordedAt': { $exists: false } },
        { 'lastLocation.recordedAt': null }
      ]
    };

    const updated = await User.findOneAndUpdate(filter, { $set: newLoc }, { new: true, select: 'lastLocation lastActive' });

    if (!updated) {
      // likely older/out-of-order point or race — not an error for the client
      return res.status(200).json({ ok: true, message: 'No update performed (incoming point older than stored)' });
    }

    return res.status(200).json({ ok: true, lastLocation: updated.lastLocation, lastActive: updated.lastActive });
  } catch (err) {
    console.error('location save error', err);
    return res.status(500).json({ error: 'server error' });
  }
};
