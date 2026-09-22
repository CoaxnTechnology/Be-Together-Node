const User = require("../model/User");
const Service = require("../model/Service");
const ServiceRequest = require("../model/ServiceRequest");

const RADIUS_KM = 30;
const CANDIDATE_POOL_SIZE = 30;
const MAX_HIGHLIGHTS = 10;
const MAX_INDIVIDUAL_ITEMS = 7;
const RECENT_WINDOW_HOURS = 48;

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function geoWithinRadius(centerLat, centerLng, radiusKm) {
  return {
    $geoWithin: {
      $centerSphere: [[centerLng, centerLat], radiusKm / 6371],
    },
  };
}

function hoursSince(date) {
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60);
}

function scoreCandidate({ distanceKm, createdAt, matched }) {
  const recencyBonus = Math.max(0, 24 - hoursSince(createdAt));
  const interestBonus = matched ? 50 : 0;
  return interestBonus + recencyBonus - distanceKm;
}

// Weighted random pick (no replacement) — higher `weight` = higher chance of
// being picked, but never a guarantee. This is what makes the feed show
// different items on every app-open instead of the exact same sorted list,
// while still letting interest-matched items dominate the odds.
function weightedRandomPick(candidates, count) {
  const pool = [...candidates];
  const picked = [];

  while (pool.length && picked.length < count) {
    const totalWeight = pool.reduce((sum, c) => sum + c.weight, 0);
    let r = Math.random() * totalWeight;
    let idx = pool.length - 1;

    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }

    picked.push(pool.splice(idx, 1)[0]);
  }

  return picked;
}

// =====================================================================
// GET HOME HIGHLIGHTS ("on app open" nearby feed)
// =====================================================================
exports.getHomeHighlights = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("interests lastLocation");
    if (!user) {
      return res.status(404).json({ isSuccess: false, message: "User not found" });
    }

    // -----------------------------
    // Resolve center point
    // -----------------------------
    const { latitude, longitude } = req.query;
    let centerLat = latitude !== undefined ? Number(latitude) : null;
    let centerLng = longitude !== undefined ? Number(longitude) : null;

    if (
      (centerLat === null || centerLng === null || Number.isNaN(centerLat) || Number.isNaN(centerLng)) &&
      user.lastLocation?.coords?.coordinates?.length === 2
    ) {
      [centerLng, centerLat] = user.lastLocation.coords.coordinates;
    }

    if (
      centerLat === null ||
      centerLng === null ||
      Number.isNaN(centerLat) ||
      Number.isNaN(centerLng) ||
      (centerLat === 0 && centerLng === 0)
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: "Location is required (send latitude/longitude, or update your last known location first)",
      });
    }

    const interests = (user.interests || []).map((t) => String(t).toLowerCase());
    const geoFilter = geoWithinRadius(centerLat, centerLng, RADIUS_KM);
    const recentSince = new Date(Date.now() - RECENT_WINDOW_HOURS * 60 * 60 * 1000);

    // -----------------------------
    // Nearby open Services (offers)
    // -----------------------------
    const nearbyServices = await Service.find({
      location: geoFilter,
      owner: { $ne: userId },
      isDeleteRequested: { $ne: true },
    })
      .select("title tags category location owner image isFree price currency createdAt")
      .populate("owner", "name")
      .populate("category", "name")
      .sort({ createdAt: -1 })
      .limit(CANDIDATE_POOL_SIZE)
      .lean();

    // -----------------------------
    // Nearby open Service Requests
    // -----------------------------
    const nearbyRequests = await ServiceRequest.find({
      location: geoFilter,
      owner: { $ne: userId },
      status: "open",
      expiresAt: { $gt: new Date() },
    })
      .select("title tags category location owner createdAt")
      .populate("owner", "name")
      .populate("category", "name")
      .sort({ createdAt: -1 })
      .limit(CANDIDATE_POOL_SIZE)
      .lean();

    // -----------------------------
    // Score + build display items
    // -----------------------------
    const items = [];

    for (const service of nearbyServices) {
      const [lng, lat] = service.location.coordinates;
      const distanceKm = haversineKm(centerLat, centerLng, lat, lng);
      const serviceTags = [
        ...(service.tags || []),
        service.category?.name || "",
      ].map((t) => t.toLowerCase());
      const matched = serviceTags.some((t) => interests.includes(t));

      items.push({
        type: "service_offer",
        message: service.isFree
          ? `${service.owner?.name || "Someone"} is offering "${service.title}" for free, ${distanceKm.toFixed(1)} km away from you.`
          : `${service.owner?.name || "Someone"} is offering "${service.title}", ${distanceKm.toFixed(1)} km away from you.`,
        score: scoreCandidate({ distanceKm, createdAt: service.createdAt, matched }),
        data: {
          serviceId: service._id,
          title: service.title,
          category: service.category?.name || null,
          ownerId: service.owner?._id || null,
          ownerName: service.owner?.name || null,
          image: service.image || null,
          isFree: service.isFree,
          price: service.price,
          currency: service.currency,
          distance_km: Number(distanceKm.toFixed(2)),
          createdAt: service.createdAt,
        },
      });
    }

    for (const request of nearbyRequests) {
      const [lng, lat] = request.location.coordinates;
      const distanceKm = haversineKm(centerLat, centerLng, lat, lng);
      const requestTags = [
        ...(request.tags || []),
        request.category?.name || "",
      ].map((t) => t.toLowerCase());
      const matched = requestTags.some((t) => interests.includes(t));

      items.push({
        type: "service_request",
        message: `${request.owner?.name || "Someone"} is looking for "${request.title}", ${distanceKm.toFixed(1)} km away from you.`,
        score: scoreCandidate({ distanceKm, createdAt: request.createdAt, matched }),
        data: {
          requestId: request._id,
          title: request.title,
          category: request.category?.name || null,
          ownerId: request.owner?._id || null,
          ownerName: request.owner?.name || null,
          distance_km: Number(distanceKm.toFixed(2)),
          createdAt: request.createdAt,
        },
      });
    }

    // -----------------------------
    // Pick items — weighted-random so the feed differs on every app-open.
    // With interests set: score (incl. +50 interest-match bonus) becomes the
    // weight, so relevant items are far more likely to surface but it's not
    // a fixed order. With no interests: every item gets equal weight, i.e.
    // a genuinely random pick, exactly as requested.
    // -----------------------------
    const hasInterests = interests.length > 0;
    const WEIGHT_OFFSET = 60; // keeps weights positive (score can go negative from the distance penalty)
    const weightedItems = items.map((item) => ({
      ...item,
      weight: hasInterests ? Math.max(1, item.score + WEIGHT_OFFSET) : 1,
    }));

    const topIndividualItems = weightedRandomPick(
      weightedItems,
      MAX_INDIVIDUAL_ITEMS,
    ).map(({ type, message, data }) => ({ type, message, data }));

    // -----------------------------
    // Aggregate summary items
    // -----------------------------
    const aggregates = [];

    const recentCount = nearbyServices.filter(
      (s) => new Date(s.createdAt) >= recentSince,
    ).length;
    if (recentCount >= 2) {
      aggregates.push({
        type: "aggregate_count",
        message: `There are ${recentCount} new events near you.`,
        data: { count: recentCount, windowHours: RECENT_WINDOW_HOURS },
      });
    }

    if (interests.length) {
      const topInterest = interests[0];
      const categoryCount = nearbyServices.filter((s) =>
        [...(s.tags || []), s.category?.name || ""]
          .map((t) => t.toLowerCase())
          .includes(topInterest),
      ).length;

      if (categoryCount >= 2) {
        const categoryLabel =
          nearbyServices.find((s) => s.category?.name?.toLowerCase() === topInterest)
            ?.category?.name || topInterest;
        aggregates.push({
          type: "aggregate_count",
          message: `There are ${categoryCount} new services in the ${categoryLabel} category near you.`,
          data: { count: categoryCount, category: categoryLabel },
        });
      }
    }

    const highlights = [...aggregates, ...topIndividualItems].slice(
      0,
      MAX_HIGHLIGHTS,
    );

    return res.json({
      isSuccess: true,
      message: "Highlights fetched successfully",
      data: highlights,
    });
  } catch (err) {
    console.error("getHomeHighlights error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
