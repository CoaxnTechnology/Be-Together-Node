// controllers/locationController.js
const User = require("../model/User");

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = x => x * Math.PI / 180;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

const ALLOWED_PROVIDERS = new Set(['gps','network','wifi','cell','fused','passive','mock', null]);

const EXPIRE_DAYS = 7;
const CLEANUP_COOLDOWN_MS = 1000 * 60 * 60; // 1 hour

if (!global.__lastLocationCleanupAt) global.__lastLocationCleanupAt = 0;

// Reset stale locations
async function expireStaleLocationsIfNeeded() {
  try {
    const now = Date.now();
    if (now - global.__lastLocationCleanupAt < CLEANUP_COOLDOWN_MS) return;
    global.__lastLocationCleanupAt = now;

    const cutoff = new Date(Date.now() - EXPIRE_DAYS*24*60*60*1000);

    const update = {
      $set: {
        "lastLocation.coords.coordinates": [0,0],
        "lastLocation.recordedAt": null,
        "lastLocation.updatedAt": new Date(),
        location_stale: true,
        updated_at: new Date()
      }
    };

    const res = await User.updateMany(
      { "lastLocation.recordedAt": { $lt: cutoff } },
      update
    );
    console.info(`expireStaleLocationsIfNeeded: matched=${res.matchedCount ?? res.n ?? 0} modified=${res.modifiedCount ?? res.nModified ?? 0}`);
  } catch (err) {
    console.error("expireStaleLocationsIfNeeded error:", err);
  }
}

exports.location = async (req, res) => {
  try {
    await expireStaleLocationsIfNeeded();

    const { userId, latitude, longitude, accuracy, provider, recordedAt } = req.body;
    const userIdToken = req.user?.id;

    if (!userIdToken) return res.status(401).json({ error: 'Unauthorized' });
    if (String(userId) !== String(userIdToken)) return res.status(403).json({ error: 'Forbidden' });

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'latitude and longitude must be numbers' });
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return res.status(400).json({ error: 'invalid coordinates' });

    // 0,0 fallback
    if (lat === 0 && lng === 0) {
      const existing = await User.findById(userId).select('lastLocation').lean();
      return res.status(200).json({
        ok: true,
        lastLocation: existing?.lastLocation ?? null,
        message: 'kept previous location'
      });
    }

    if (provider && !ALLOWED_PROVIDERS.has(provider)) console.warn(`Unknown provider "${provider}" from user ${userId}`);

    const recAt = recordedAt ? new Date(recordedAt) : new Date();
    if (isNaN(recAt.getTime())) return res.status(400).json({ error: 'invalid recordedAt' });

    const now = new Date();
    const MAX_FUTURE_MS = 1000*60*5;
    const MAX_PAST_MS = 1000*60*60*24*30;
    if (recAt - now > MAX_FUTURE_MS) return res.status(400).json({ error: 'recordedAt is in the near future' });
    if (now - recAt > MAX_PAST_MS) return res.status(400).json({ error: 'recordedAt too old' });

    // Read previous location
    const user = await User.findById(userId).select('lastLocation').lean();
    const MIN_MOVE_METERS = 20;

    let shouldUpdate = true;
    if (
      user?.lastLocation?.recordedAt &&
      user.lastLocation.coords.coordinates[0] !== 0 &&
      user.lastLocation.coords.coordinates[1] !== 0
    ) {
      const [oldLng, oldLat] = user.lastLocation.coords.coordinates;
      const dist = haversineDistance(oldLat, oldLng, lat, lng);
      if (dist < MIN_MOVE_METERS) shouldUpdate = false;
    }

    if (!shouldUpdate) return res.status(200).json({ ok: true, message: 'Location too close to previous, skipped' });

    const newLoc = {
      'lastLocation.coords': { type: 'Point', coordinates: [lng, lat] },
      'lastLocation.accuracy': accuracy != null ? Number(accuracy) : null,
      'lastLocation.provider': provider || null,
      'lastLocation.recordedAt': recAt,
      'lastLocation.updatedAt': new Date(),
      lastActive: new Date()
    };

    const filter = {
      _id: userId,
      $or: [
        { 'lastLocation.recordedAt': { $lt: recAt } },
        { 'lastLocation.recordedAt': { $exists: false } },
        { 'lastLocation.recordedAt': null }
      ]
    };

    const updated = await User.findOneAndUpdate(filter, { $set: newLoc }, { new: true, select: 'lastLocation lastActive' });

    if (!updated) return res.status(200).json({ ok: true, message: 'No update performed (incoming point older than stored)' });

    return res.status(200).json({ ok: true, lastLocation: updated.lastLocation, lastActive: updated.lastActive });
  } catch (err) {
    console.error('location save error', err);
    return res.status(500).json({ error: 'server error' });
  }
};
