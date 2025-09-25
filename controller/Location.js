// controllers/locationController.js
const User = require("../model/User");

// Utility: Haversine distance in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  function toRad(x) { return (x * Math.PI) / 180; }
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const ALLOWED_PROVIDERS = new Set([
  "gps", "network", "wifi", "cell", "fused", "passive", "mock", null,
]);

exports.location = async (req, res) => {
  try {
    const { userId, latitude, longitude, accuracy, provider, recordedAt } = req.body;
    const userIdToken = req.user && req.user.id;

    // ✅ Auth check
    if (!userIdToken) return res.status(401).json({ error: "Unauthorized" });
    if (String(userId) !== String(userIdToken)) return res.status(403).json({ error: "Forbidden" });

    // ✅ Validate coordinates
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "latitude and longitude must be numbers" });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: "invalid coordinates" });
    }

    // ✅ If client sends 0,0 → return previous location without update
    if (lat === 0 && lng === 0) {
      const existing = await User.findById(userId).select("lastLocation").lean();
      return res.status(200).json({
        ok: true,
        lastLocation: existing ? existing.lastLocation : null,
        message: "kept previous location",
      });
    }

    // ✅ Validate provider
    if (provider !== undefined && !ALLOWED_PROVIDERS.has(provider)) {
      console.warn(`Unknown provider "${provider}" from user ${userId}`);
    }

    // ✅ Validate recordedAt
    const recAt = recordedAt ? new Date(recordedAt) : new Date();
    if (isNaN(recAt.getTime())) {
      return res.status(400).json({ error: "invalid recordedAt" });
    }

    const now = new Date();
    const MAX_FUTURE_MS = 1000 * 60 * 5; // 5 minutes future allowed
    const MAX_PAST_MS = 1000 * 60 * 60 * 24 * 30; // 30 days past allowed
    if (recAt - now > MAX_FUTURE_MS) return res.status(400).json({ error: "recordedAt is in the near future" });
    if (now - recAt > MAX_PAST_MS) return res.status(400).json({ error: "recordedAt too old" });

    // ✅ Check last location
    const user = await User.findById(userId).select("lastLocation").lean();
    const MIN_MOVE_METERS = 20;
    let shouldUpdate = true;

    if (user && user.lastLocation && user.lastLocation.recordedAt) {
      const oldCoords = user.lastLocation.coords?.coordinates;
      if (oldCoords && oldCoords.length === 2) {
        const [oldLng, oldLat] = oldCoords;
        const dist = haversineDistance(oldLat, oldLng, lat, lng);
        if (dist < MIN_MOVE_METERS) {
          shouldUpdate = false;
        }
      }
    }

    if (!shouldUpdate) {
      return res.status(200).json({ ok: true, message: "Location too close to previous, skipped" });
    }

    // ✅ Prepare update payload
    const newLoc = {
      "lastLocation.coords.coordinates": [lng, lat],
      "lastLocation.accuracy": accuracy == null ? null : Number(accuracy),
      "lastLocation.provider": provider || null,
      "lastLocation.recordedAt": recAt,
      "lastLocation.updatedAt": new Date(),
      lastActive: new Date(),
    };

    // ✅ Save always (first time + subsequent updates)
    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: newLoc },
      { new: true, select: "lastLocation lastActive" }
    );

    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      ok: true,
      lastLocation: updated.lastLocation,
      lastActive: updated.lastActive,
    });
  } catch (err) {
    console.error("location save error", err);
    return res.status(500).json({ error: "server error" });
  }
};
