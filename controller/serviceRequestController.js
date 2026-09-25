const mongoose = require("mongoose");
const ServiceRequest = require("../model/ServiceRequest");
const ServiceRequestOffer = require("../model/ServiceRequestOffer");
const Booking = require("../model/Booking");
const User = require("../model/User");
const Category = require("../model/Category");
const {
  notifyOnNewServiceRequest,
  notifyNewOffer,
  notifyOfferAccepted,
  notifyOfferDeclined,
  notifyGroupFilled,
} = require("./notificationController");
const paymentController = require("./paymentController");
const {
  parseDateTime,
  formatDateTime,
  timeAgo,
} = require("../utils/dateTimeFormat");

const SERVICE_TYPES = ["doorstep", "pickDrop", "atTheirPlace"];
const REQUEST_MODES = ["paid_fixed", "paid_offer", "free_single", "free_group"];

// Adds display-friendly fields to a plain (lean) ServiceRequest object:
// - expiresAt formatted as "18/09/2026 06:00 PM" (was a raw Date)
// - createdAgo, social-media style ("2 hours ago")
// - seatsAvailable, so the app knows whether to still show Book Now/Join
function decorateRequest(r) {
  return {
    ...r,
    expiresAt: formatDateTime(r.expiresAt),
    createdAgo: timeAgo(r.createdAt),
    seatsAvailable:
      typeof r.numberOfParticipants === "number"
        ? Math.max(0, r.numberOfParticipants - (r.seatsBooked || 0))
        : null,
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
      requestMode,
      schedule,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Title is required" });
    }

    // -----------------------------
    // requestMode decides everything downstream (client-finalized 24 Sep
    // 2026): which button the app shows, whether money is involved, and
    // whether the request accepts many bookings/joins or just one.
    // `isFree` is derived from this instead of being a separate input, so
    // the two can never contradict each other.
    // -----------------------------
    if (!requestMode || !REQUEST_MODES.includes(requestMode)) {
      return res.status(400).json({
        isSuccess: false,
        message: `requestMode must be one of: ${REQUEST_MODES.join(", ")}`,
      });
    }
    const freeFlag = requestMode === "free_single" || requestMode === "free_group";

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
    // Budget:
    // - paid_fixed: REQUIRED — the price is fixed upfront, so it must be
    //   known at creation time (currency + a positive amount).
    // - paid_offer: stays optional (e.g. "need a plumber" — the requester
    //   often has no idea what it'll cost; providers set the price via
    //   their Offer instead). If partially filled in anyway, currency + a
    //   positive amount must both be present together.
    // - free_single / free_group: always forced to null — no money involved.
    // -----------------------------
    let budgetPayload = { currency: null, amount: null };
    if (requestMode === "paid_fixed") {
      const amountNum = Number(budget?.amount);
      if (!budget?.currency || !Number.isFinite(amountNum) || amountNum <= 0) {
        return res.status(400).json({
          isSuccess: false,
          message: "budget.currency and a positive budget.amount are required for a paid_fixed request",
        });
      }
      budgetPayload = {
        currency: String(budget.currency).toUpperCase(),
        amount: amountNum,
      };
    } else if (
      requestMode === "paid_offer" &&
      (budget?.currency || budget?.amount !== undefined)
    ) {
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

    const serviceRequest = await ServiceRequest.create({
      title: title.trim(),
      description: description || null,
      serviceType,
      ...locationPayload,
      numberOfParticipants: participants,
      requestMode,
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

    // ⭐ Nearest first (in ~1km buckets, so "distance" stays the primary
    // signal), then the owner's rating breaks ties within the same bucket,
    // then most recent. Unrated owners are treated as neutral (0), never
    // penalized below other unrated owners.
    const { getProviderRating } = require("./Review");
    const ownerIds = [...new Set(listCandidates.map((r) => String(r.owner?._id || r.owner)))];
    const ratingByOwner = {};
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        ratingByOwner[ownerId] = await getProviderRating(ownerId);
      }),
    );
    listCandidates.forEach((r) => {
      const ownerId = String(r.owner?._id || r.owner);
      r.ownerRating = ratingByOwner[ownerId]?.averageRating || 0;
      r.ownerReviewCount = ratingByOwner[ownerId]?.totalReviews || 0;
    });

    listCandidates.sort((a, b) => {
      const aDist = a.distance_km ?? Infinity;
      const bDist = b.distance_km ?? Infinity;
      const aBucket = Number.isFinite(aDist) ? Math.floor(aDist) : Infinity;
      const bBucket = Number.isFinite(bDist) ? Math.floor(bDist) : Infinity;
      if (aBucket !== bBucket) return aBucket - bBucket;

      const aScore = a.ownerRating * Math.min(a.ownerReviewCount, 20);
      const bScore = b.ownerRating * Math.min(b.ownerReviewCount, 20);
      if (aScore !== bScore) return bScore - aScore;

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
    const { userId } = req.query; // optional — viewer's id, no auth required

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Invalid service request id" });
    }

    const request = await ServiceRequest.findById(id)
      .populate("category", "name")
      .populate("owner", "name profile_image")
      .lean();

    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }

    const ownerId = request.owner?._id || request.owner;
    const isOwner = Boolean(userId) && String(ownerId) === String(userId);

    return res.json({
      isSuccess: true,
      message: "Service request fetched successfully",
      data: {
        ...decorateRequest(request),
        isOwner,
        showBookingButton: !isOwner,
      },
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

// =====================================================================
// CATEGORY A — PAID, FIXED PRICE: book a seat directly ("Book Now")
// =====================================================================
exports.bookFixedRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }
    const { id } = req.params;
    const { phone, location_name, latitude, longitude, useWallet } = req.body;

    const request = await ServiceRequest.findById(id);
    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }
    if (request.requestMode !== "paid_fixed") {
      return res.status(400).json({
        isSuccess: false,
        message: "This request is not a fixed-price booking",
      });
    }
    if (request.status !== "open") {
      return res
        .status(400)
        .json({ isSuccess: false, message: "This request is no longer open" });
    }
    if (String(request.owner) === String(userId)) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "You cannot book your own request" });
    }

    // Mirror bookService's own pre-check so a seat is never reserved for a
    // booking that's guaranteed to fail immediately afterward.
    const provider = await User.findById(request.owner);
    if (!provider?.stripeAccountId) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Provider stripe account missing" });
    }

    // Atomic seat reservation — guarantees only one winner even if many
    // customers try to book the last seat at the exact same moment.
    const updated = await ServiceRequest.findOneAndUpdate(
      {
        _id: id,
        status: "open",
        $expr: { $lt: ["$seatsBooked", "$numberOfParticipants"] },
      },
      { $inc: { seatsBooked: 1 } },
      { new: true },
    );
    if (!updated) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "No seats available" });
    }
    if (updated.seatsBooked >= updated.numberOfParticipants) {
      updated.status = "fulfilled";
      await updated.save();
    }

    // Reuse the exact same booking/payment function as a normal Service
    // booking — only the price/provider source differs.
    req.body.userId = userId;
    req.body.providerId = String(request.owner);
    req.body.serviceRequestId = id;
    req.body.phone = phone;
    req.body.location_name = location_name;
    req.body.latitude = latitude;
    req.body.longitude = longitude;
    req.body.useWallet = useWallet;
    return paymentController.bookService(req, res);
  } catch (err) {
    console.error("bookFixedRequest error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// CATEGORY B — PAID, OFFER-BASED: submit / list / withdraw / accept
// =====================================================================
exports.submitOffer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }
    const { id } = req.params;
    const { amount, currency, note } = req.body;

    const request = await ServiceRequest.findById(id);
    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }
    if (request.requestMode !== "paid_offer") {
      return res.status(400).json({
        isSuccess: false,
        message: "This request does not accept Offers",
      });
    }
    if (request.status !== "open") {
      return res
        .status(400)
        .json({ isSuccess: false, message: "This request is no longer open" });
    }
    if (String(request.owner) === String(userId)) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "You cannot offer on your own request" });
    }

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "A positive amount is required" });
    }
    // Required per the client's risk-mitigation decision (24 Sep 2026) —
    // every Offer must explain the price.
    if (!note || !String(note).trim()) {
      return res.status(400).json({
        isSuccess: false,
        message: "A note explaining the price is required",
      });
    }

    const existing = await ServiceRequestOffer.findOne({
      request: id,
      provider: userId,
      status: "pending",
    });
    if (existing) {
      return res.status(400).json({
        isSuccess: false,
        message: "You already have an active offer on this request",
      });
    }

    const offer = await ServiceRequestOffer.create({
      request: id,
      provider: userId,
      amount: amountNum,
      currency: currency || request.budget?.currency || "EUR",
      note: note.trim(),
    });

    notifyNewOffer(request, offer).catch((err) =>
      console.error("❌ notifyNewOffer error:", err),
    );

    return res.status(201).json({
      isSuccess: true,
      message: "Offer submitted successfully",
      data: offer,
    });
  } catch (err) {
    console.error("submitOffer error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

exports.listOffers = async (req, res) => {
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
      return res.status(403).json({
        isSuccess: false,
        message: "You can only view offers on your own request",
      });
    }

    const offers = await ServiceRequestOffer.find({ request: id })
      .populate("provider", "name profile_image")
      .lean();

    // ⭐ Rank by the provider's rating (capped review-count weight so one
    // 5-star from a brand-new provider can't outrank someone with 100 solid
    // reviews), amount as tiebreak — reviews live in the Service-Request
    // world too since Review now derives `provider` from `booking.provider`.
    // Providers with no reviews yet are neither boosted nor penalized — they
    // sort after rated providers, by amount only.
    const { getProviderRating } = require("./Review");
    const withRating = await Promise.all(
      offers.map(async (offer) => {
        const { averageRating, totalReviews } = await getProviderRating(
          offer.provider?._id || offer.provider,
        );
        return {
          ...offer,
          providerRating: averageRating,
          providerReviewCount: totalReviews,
          _rankScore: averageRating * Math.min(totalReviews, 20),
        };
      }),
    );
    withRating.sort((a, b) => {
      if (a.providerReviewCount === 0 && b.providerReviewCount === 0) {
        return a.amount - b.amount;
      }
      if (a._rankScore !== b._rankScore) return b._rankScore - a._rankScore;
      return a.amount - b.amount;
    });
    const rankedOffers = withRating.map(({ _rankScore, ...rest }) => rest);

    return res.json({ isSuccess: true, data: rankedOffers });
  } catch (err) {
    console.error("listOffers error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

exports.withdrawOffer = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { offerId } = req.params;

    const offer = await ServiceRequestOffer.findById(offerId);
    if (!offer) {
      return res.status(404).json({ isSuccess: false, message: "Offer not found" });
    }
    if (String(offer.provider) !== String(userId)) {
      return res
        .status(403)
        .json({ isSuccess: false, message: "You can only withdraw your own offer" });
    }
    if (offer.status !== "pending") {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Only a pending offer can be withdrawn" });
    }

    offer.status = "withdrawn";
    await offer.save();

    return res.json({ isSuccess: true, message: "Offer withdrawn" });
  } catch (err) {
    console.error("withdrawOffer error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

exports.acceptOffer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }
    const { id, offerId } = req.params;
    const { phone, location_name, latitude, longitude, useWallet } = req.body;

    const request = await ServiceRequest.findById(id);
    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }
    if (String(request.owner) !== String(userId)) {
      return res.status(403).json({
        isSuccess: false,
        message: "You can only accept offers on your own request",
      });
    }
    if (request.requestMode !== "paid_offer") {
      return res.status(400).json({
        isSuccess: false,
        message: "This request does not accept Offers",
      });
    }

    const offer = await ServiceRequestOffer.findById(offerId);
    if (!offer || String(offer.request) !== String(id)) {
      return res.status(404).json({ isSuccess: false, message: "Offer not found" });
    }
    if (offer.status !== "pending") {
      return res
        .status(400)
        .json({ isSuccess: false, message: "This offer is no longer available" });
    }

    // Mirror bookService's own pre-check so a seat is never reserved for a
    // booking that's guaranteed to fail immediately afterward.
    const provider = await User.findById(offer.provider);
    if (!provider?.stripeAccountId) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Provider stripe account missing" });
    }

    // Same atomic seat-style lock as Category A — also naturally supports
    // accepting more than one Offer when numberOfParticipants > 1 (e.g.
    // "need 2 painters").
    const updated = await ServiceRequest.findOneAndUpdate(
      {
        _id: id,
        status: "open",
        $expr: { $lt: ["$seatsBooked", "$numberOfParticipants"] },
      },
      { $inc: { seatsBooked: 1 } },
      { new: true },
    );
    if (!updated) {
      return res.status(400).json({
        isSuccess: false,
        message: "This request is already fully booked",
      });
    }

    offer.status = "accepted";
    await offer.save();

    notifyOfferAccepted(request, offer).catch((err) =>
      console.error("❌ notifyOfferAccepted error:", err),
    );

    if (updated.seatsBooked >= updated.numberOfParticipants) {
      updated.status = "fulfilled";
      await updated.save();

      const stillPending = await ServiceRequestOffer.find({
        request: id,
        status: "pending",
      });
      await ServiceRequestOffer.updateMany(
        { request: id, status: "pending" },
        { status: "declined" },
      );
      stillPending.forEach((declined) => {
        notifyOfferDeclined(request, declined).catch((err) =>
          console.error("❌ notifyOfferDeclined error:", err),
        );
      });
    }

    // Reuse the exact same booking/payment function as a normal Service
    // booking — the price/provider come from the accepted Offer.
    req.body.userId = userId;
    req.body.providerId = String(offer.provider);
    req.body.serviceRequestId = id;
    req.body.offerId = String(offer._id);
    req.body.phone = phone;
    req.body.location_name = location_name;
    req.body.latitude = latitude;
    req.body.longitude = longitude;
    req.body.useWallet = useWallet;
    return paymentController.bookService(req, res);
  } catch (err) {
    console.error("acceptOffer error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// CATEGORY C & D — FREE (single) / FREE GROUP: Join
// =====================================================================
exports.joinRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }
    const { id } = req.params;
    const { phone, location_name, latitude, longitude } = req.body;

    if (!phone) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Phone number is required" });
    }

    const request = await ServiceRequest.findById(id);
    if (!request) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service request not found" });
    }
    if (!["free_single", "free_group"].includes(request.requestMode)) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "This request cannot be joined" });
    }
    if (String(request.owner) === String(userId)) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "You cannot join your own request" });
    }

    let updated;
    if (request.requestMode === "free_single") {
      // Atomic single-winner lock — first Join to land wins.
      updated = await ServiceRequest.findOneAndUpdate(
        { _id: id, status: "open" },
        { status: "fulfilled", joinedBy: userId },
        { new: true },
      );
      if (!updated) {
        return res.status(400).json({ isSuccess: false, message: "Already taken" });
      }
    } else {
      // free_group — same atomic seat-counter pattern as Category A, just
      // with no payment involved.
      updated = await ServiceRequest.findOneAndUpdate(
        {
          _id: id,
          status: "open",
          $expr: { $lt: ["$seatsBooked", "$numberOfParticipants"] },
        },
        { $inc: { seatsBooked: 1 } },
        { new: true },
      );
      if (!updated) {
        return res
          .status(400)
          .json({ isSuccess: false, message: "No spots available" });
      }
      if (updated.seatsBooked >= updated.numberOfParticipants) {
        updated.status = "fulfilled";
        await updated.save();
        notifyGroupFilled(updated).catch((err) =>
          console.error("❌ notifyGroupFilled error:", err),
        );
      }
    }

    // Same zero-amount Booking pattern as a normal free Service booking —
    // no Payment doc at all, since no money is involved.
    const booking = await Booking.create({
      customer: userId,
      provider: request.owner,
      serviceRequest: id,
      amount: 0,
      status: "booked",
      contactPhone: phone,
      location_name: location_name || null,
      ...(latitude &&
        longitude && {
          location: {
            type: "Point",
            coordinates: [Number(longitude), Number(latitude)],
          },
        }),
    });

    return res.status(201).json({
      isSuccess: true,
      message: "Joined successfully",
      bookingId: booking._id,
    });
  } catch (err) {
    console.error("joinRequest error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
