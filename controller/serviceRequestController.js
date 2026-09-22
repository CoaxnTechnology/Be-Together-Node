const ServiceRequest = require("../model/ServiceRequest");
const User = require("../model/User");
const Category = require("../model/Category");
const { notifyOnNewServiceRequest } = require("./notificationController");
const {
  parseDateTime,
  formatDateTime,
  timeAgo,
} = require("../utils/dateTimeFormat");

const MAX_REQUESTS_PER_DAY = 5;
const SERVICE_TYPES = ["doorstep", "pickDrop", "atTheirPlace"];

// Adds display-friendly fields to a plain (lean) ServiceRequest object:
// - expiresAt formatted as "18/09/2026 06:00 PM" (was a raw Date)
// - createdAgo, social-media style ("2 hours ago")
function decorateRequest(r) {
  return {
    ...r,
    expiresAt: formatDateTime(r.expiresAt),
    createdAgo: timeAgo(r.createdAt),
  };
}

function isValidLatLng(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

function normalizeArrayInput(value) {
  if (!value) return [];
  let parsed = value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        parsed = trimmed;
      }
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof parsed === "string") {
    return parsed
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

// =====================================================================
// CREATE SERVICE REQUEST
// =====================================================================
exports.createServiceRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }

    const {
      title,
      description,
      serviceType,
      doorstepLocation,
      pickupLocation,
      dropLocation,
      atTheirPlaceLocation,
      numberOfParticipants,
      category,
      tags,
      budget,
      isFree,
      schedule,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Title is required" });
    }

    // -----------------------------
    // serviceType decides which location block(s) are required
    // -----------------------------
    if (!serviceType || !SERVICE_TYPES.includes(serviceType)) {
      return res.status(400).json({
        isSuccess: false,
        message: `serviceType must be one of: ${SERVICE_TYPES.join(", ")}`,
      });
    }

    let mainCoords = null; // [lng, lat] used for the geo-radius `location` field
    let mainCity = null;
    const locationPayload = {};

    if (serviceType === "doorstep") {
      const loc = doorstepLocation || {};
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (!isValidLatLng(lat, lng) || !loc.city || !loc.address) {
        return res.status(400).json({
          isSuccess: false,
          message: "doorstepLocation requires latitude, longitude, city and address",
        });
      }
      mainCoords = [lng, lat];
      mainCity = loc.city;
      locationPayload.doorstepLocation = {
        latitude: lat,
        longitude: lng,
        city: loc.city,
        address: loc.address,
      };
    } else if (serviceType === "pickDrop") {
      const pu = pickupLocation || {};
      const dr = dropLocation || {};
      const puLat = Number(pu.latitude);
      const puLng = Number(pu.longitude);
      const drLat = Number(dr.latitude);
      const drLng = Number(dr.longitude);

      if (!isValidLatLng(puLat, puLng) || !pu.city || !pu.address) {
        return res.status(400).json({
          isSuccess: false,
          message: "pickupLocation requires latitude, longitude, city and address",
        });
      }
      if (!isValidLatLng(drLat, drLng) || !dr.city || !dr.address) {
        return res.status(400).json({
          isSuccess: false,
          message: "dropLocation requires latitude, longitude, city and address",
        });
      }

      mainCoords = [puLng, puLat]; // radius search centers on the pickup point
      mainCity = pu.city;
      locationPayload.pickupLocation = {
        latitude: puLat,
        longitude: puLng,
        city: pu.city,
        address: pu.address,
      };
      locationPayload.dropLocation = {
        latitude: drLat,
        longitude: drLng,
        city: dr.city,
        address: dr.address,
      };
    } else {
      // atTheirPlace
      const loc = atTheirPlaceLocation || {};
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (!isValidLatLng(lat, lng) || !loc.city) {
        return res.status(400).json({
          isSuccess: false,
          message: "atTheirPlaceLocation requires latitude, longitude and city",
        });
      }
      mainCoords = [lng, lat];
      mainCity = loc.city;
      locationPayload.atTheirPlaceLocation = {
        latitude: lat,
        longitude: lng,
        city: loc.city,
      };
    }

    // -----------------------------
    // Category is compulsory, and every selected tag must actually belong
    // to that category (reject anything the user shouldn't be able to pick).
    // -----------------------------
    if (!category) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "category is required" });
    }
    const categoryDoc = await Category.findById(category).select("name tags");
    if (!categoryDoc) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Invalid category selected" });
    }

    const normalizedTags = normalizeArrayInput(tags);
    if (!normalizedTags.length) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "At least one tag is required" });
    }
    const allowedTags = (categoryDoc.tags || []).map((t) =>
      String(t).toLowerCase(),
    );
    const invalidTags = normalizedTags.filter((t) => !allowedTags.includes(t));
    if (invalidTags.length) {
      return res.status(400).json({
        isSuccess: false,
        message: `These tags are not valid for the "${categoryDoc.name}" category: ${invalidTags.join(", ")}`,
      });
    }

    // -----------------------------
    // Budget — always optional (e.g. "need a plumber" — the requester often
    // has no idea what it'll cost until the provider actually sees the job).
    // isFree=true forces it to null regardless of what's sent; isFree=false
    // just means "not free" — a budget number is still not required, but if
    // the user does start filling it in, currency + a positive amount must
    // both be present together (no half-filled budget).
    // -----------------------------
    const freeFlag = isFree === true || isFree === "true";
    let budgetPayload = { currency: null, amount: null };
    if (!freeFlag && (budget?.currency || budget?.amount !== undefined)) {
      const amountNum = Number(budget?.amount);
      if (!budget?.currency || !Number.isFinite(amountNum) || amountNum <= 0) {
        return res.status(400).json({
          isSuccess: false,
          message: "If provided, budget.currency and a positive budget.amount must both be given",
        });
      }
      budgetPayload = {
        currency: String(budget.currency).toUpperCase(),
        amount: amountNum,
      };
    }

    // -----------------------------
    // Number of participants — optional, defaults to 1
    // -----------------------------
    let participants = 1;
    if (numberOfParticipants !== undefined) {
      participants = parseInt(numberOfParticipants, 10);
      if (!Number.isInteger(participants) || participants < 1) {
        return res.status(400).json({
          isSuccess: false,
          message: "numberOfParticipants must be a positive integer",
        });
      }
    }

    // -----------------------------
    // Schedule — date + startTime required, endTime optional.
    // expiresAt is auto-derived (date + endTime, falling back to startTime)
    // so the user never has to enter a separate expiry.
    // -----------------------------
    if (!schedule?.date || !schedule?.startTime) {
      return res.status(400).json({
        isSuccess: false,
        message: "schedule.date (DD/MM/YYYY) and schedule.startTime (hh:mm AM/PM) are required",
      });
    }
    const parsedStartTime = parseDateTime(`${schedule.date} ${schedule.startTime}`);
    if (!parsedStartTime) {
      return res.status(400).json({
        isSuccess: false,
        message: "schedule.date/startTime must be in DD/MM/YYYY + hh:mm AM/PM format",
      });
    }

    let parsedExpiry = parsedStartTime;
    if (schedule.endTime) {
      parsedExpiry = parseDateTime(`${schedule.date} ${schedule.endTime}`);
      if (!parsedExpiry) {
        return res.status(400).json({
          isSuccess: false,
          message: "schedule.endTime must be in hh:mm AM/PM format",
        });
      }
    }

    if (parsedExpiry <= new Date()) {
      return res.status(400).json({
        isSuccess: false,
        message: "schedule date/time must be in the future",
      });
    }

    // -----------------------------
    // Rate limit: max N open requests created in the last 24h
    // -----------------------------
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await ServiceRequest.countDocuments({
      owner: userId,
      createdAt: { $gte: since },
    });

    if (recentCount >= MAX_REQUESTS_PER_DAY) {
      return res.status(429).json({
        isSuccess: false,
        message: `You can only create ${MAX_REQUESTS_PER_DAY} requests per day. Please try again later.`,
      });
    }

    const serviceRequest = await ServiceRequest.create({
      title: title.trim(),
      description: description || null,
      serviceType,
      ...locationPayload,
      numberOfParticipants: participants,
      category: categoryDoc._id,
      tags: normalizedTags,
      budget: budgetPayload,
      isFree: freeFlag,
      schedule: {
        date: schedule.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime || null,
      },
      location_name: mainCity,
      location: {
        type: "Point",
        coordinates: mainCoords,
      },
      owner: userId,
      status: "open",
      expiresAt: parsedExpiry,
    });

    // Fire-and-forget — never let a notification failure break the API response
    notifyOnNewServiceRequest(serviceRequest).catch((err) =>
      console.error("❌ notifyOnNewServiceRequest error:", err),
    );

    return res.status(201).json({
      isSuccess: true,
      message: "Service request created successfully",
      data: decorateRequest(serviceRequest.toObject()),
    });
  } catch (err) {
    console.error("createServiceRequest error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// LIST NEARBY SERVICE REQUESTS — dedicated "Service Requests" page
// Mirrors the same lat/long + radius pattern as serviceController.getServices
// (POST /api/service/get), just applied to ServiceRequest instead of Service.
// =====================================================================
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

exports.getServiceRequests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      categoryId = [],
      tags = [],
      latitude,
      longitude,
      radius_km,
      filterLat,
      filterLng,
      keyword = "",
    } = req.body;

    const userId = req.user?.id; // optionalAuth — may be null for guests

    const userLat = isNaN(Number(latitude)) ? null : Number(latitude);
    const userLng = isNaN(Number(longitude)) ? null : Number(longitude);
    const cityLat = filterLat ? Number(filterLat) : null;
    const cityLng = filterLng ? Number(filterLng) : null;
    const maxRadius = radius_km ? Number(radius_km) : null;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));

    // -----------------------------
    // Base filter — only OPEN, non-expired requests ever show up here.
    // (fulfilled/closed/expired requests disappear automatically.)
    // -----------------------------
    const baseMatch = {
      status: "open",
      expiresAt: { $gt: new Date() },
    };

    if (Array.isArray(categoryId) && categoryId.length) {
      baseMatch.category = { $in: categoryId };
    }
    if (Array.isArray(tags) && tags.length) {
      baseMatch.tags = { $in: tags.map((t) => String(t).toLowerCase()) };
    }

    // Same block-user convention as serviceController.getServices
    if (userId) {
      const currentUser = await User.findById(userId).select("blockedUsers");
      const myBlocked = currentUser?.blockedUsers || [];
      const blockedByOthers = await User.find({ blockedUsers: userId }).select(
        "_id",
      );
      const blockedIds = [
        ...new Set([...myBlocked, ...blockedByOthers.map((u) => u._id)]),
      ];
      if (blockedIds.length) baseMatch.owner = { $nin: blockedIds };
    }

    let requests = await ServiceRequest.find(baseMatch)
      .populate("category", "name")
      .populate("owner", "name profile_image")
      .lean();

    // Keyword search
    if (keyword.trim() !== "") {
      const safe = keyword.trim().replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      requests = requests.filter(
        (r) =>
          regex.test(r.title || "") ||
          regex.test(r.description || "") ||
          (r.tags && r.tags.some((t) => regex.test(String(t)))) ||
          (r.category?.name && regex.test(String(r.category.name))) ||
          regex.test(r.location_name || "") ||
          (r.owner?.name && regex.test(String(r.owner.name))),
      );
    }

    // Distance annotation
    requests = requests.map((r) => {
      const coords = r.location?.coordinates;
      r.distance_km =
        coords && userLat !== null && userLng !== null
          ? getDistanceKm(userLat, userLng, Number(coords[1]), Number(coords[0]))
          : null;
      return r;
    });

    // Radius filter — skipped when a keyword search is active, same as getServices
    let listCandidates = requests;
    if (keyword.trim() === "") {
      const centerLat = cityLat !== null ? cityLat : userLat;
      const centerLng = cityLng !== null ? cityLng : userLng;

      if (centerLat !== null && centerLng !== null && maxRadius !== null) {
        listCandidates = requests.filter((r) => {
          const coords = r.location?.coordinates;
          if (!coords) return false;
          return (
            getDistanceKm(centerLat, centerLng, Number(coords[1]), Number(coords[0])) <=
            maxRadius
          );
        });
      }
    }

    // Nearest first, then most recent
    listCandidates.sort((a, b) => {
      const aDist = a.distance_km ?? Infinity;
      const bDist = b.distance_km ?? Infinity;
      if (aDist !== bDist) return aDist - bDist;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const start = (pageNum - 1) * limitNum;
    const paginated = listCandidates.slice(start, start + limitNum).map(decorateRequest);

    return res.json({
      isSuccess: true,
      message: "Service requests fetched successfully",
      total: listCandidates.length,
      page: pageNum,
      limit: limitNum,
      data: paginated,
    });
  } catch (err) {
    console.error("getServiceRequests error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// GET MY SERVICE REQUESTS
// =====================================================================
exports.getMyServiceRequests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }

    const requests = await ServiceRequest.find({ owner: userId })
      .populate("category", "name")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      isSuccess: true,
      message: "Service requests fetched successfully",
      data: requests.map(decorateRequest),
    });
  } catch (err) {
    console.error("getMyServiceRequests error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// GET SERVICE REQUEST BY ID
// =====================================================================
exports.getServiceRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await ServiceRequest.findById(id)
      .populate("category", "name")
      .populate("owner", "name profile_image")
      .lean();

    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }

    return res.json({
      isSuccess: true,
      message: "Service request fetched successfully",
      data: decorateRequest(request),
    });
  } catch (err) {
    console.error("getServiceRequestById error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// UPDATE STATUS (owner-only: mark fulfilled / closed)
// =====================================================================
exports.updateServiceRequestStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { status } = req.body;

    if (!["fulfilled", "closed", "open"].includes(status)) {
      return res.status(400).json({ isSuccess: false, message: "Invalid status" });
    }

    const request = await ServiceRequest.findById(id);
    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }

    if (String(request.owner) !== String(userId)) {
      return res
        .status(403)
        .json({ isSuccess: false, message: "You can only update your own request" });
    }

    request.status = status;
    await request.save();

    return res.json({
      isSuccess: true,
      message: "Service request updated successfully",
      data: decorateRequest(request.toObject()),
    });
  } catch (err) {
    console.error("updateServiceRequestStatus error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// DELETE (owner-only)
// =====================================================================
exports.deleteServiceRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const request = await ServiceRequest.findById(id);
    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }

    if (String(request.owner) !== String(userId)) {
      return res
        .status(403)
        .json({ isSuccess: false, message: "You can only delete your own request" });
    }

    await ServiceRequest.findByIdAndDelete(id);

    return res.json({
      isSuccess: true,
      message: "Service request deleted successfully",
    });
  } catch (err) {
    console.error("deleteServiceRequest error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
