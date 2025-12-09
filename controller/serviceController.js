const moment = require("moment");
const User = require("../model/User");
const Category = require("../model/Category");
const Service = require("../model/Service");
const mongoose = require("mongoose");
const notificationController = require("./notificationController");
const { notifyOnNewService } = require("./notificationController");
const { notifyOnServiceView } = require("./notificationController");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const axios = require("axios");
const { Types } = mongoose;
const Review = require("../model/review");
// Helper to parse JSON safely
function tryParse(val) {
  if (val === undefined || val === null) return val;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return val;
  }
}

// Simple date/time validators
function isValidTime(t) {
  return typeof t === "string" && /^\d{2}:\d{2}(\s?(AM|PM))?$/i.test(t);
}

function isValidDateISO(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// Helper to format time to AM/PM
function formatTimeToAMPM(timeStr) {
  if (!timeStr) return null;
  const m = moment(timeStr, ["HH:mm", "hh:mm A"], true);
  if (!m.isValid()) return null;
  return m.format("hh:mm A");
}

// Main createService function
exports.createService = async (req, res) => {
  try {
    console.log("===== createService called =====");

    const userId = req.body.userId || (req.user && req.user.id);
    if (!userId)
      return res
        .status(400)
        .json({ isSuccess: false, message: "userId is required" });

    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found" });
    if (!user.is_active)
      return res
        .status(403)
        .json({ isSuccess: false, message: "User is not active" });

    // --- Debug Stripe info ---
    console.log("User Stripe Customer ID:", user.stripeCustomerId);
    if (user.stripeCustomerId) {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: "card",
      });
      console.log("Attached Payment Methods:", paymentMethods.data);
      if (!paymentMethods.data.length)
        console.log("User has no payment methods attached!");
    } else {
      console.log("User is not registered in Stripe yet.");
    }

    const body = req.body;
    const title = body.title && String(body.title).trim();
    const description = body.description || "";
    const language = body.language || body.Language || "English";
    const isFree = body.isFree === true || body.isFree === "true";
    const price = isFree ? 0 : Number(body.price || 0);
    const location = tryParse(body.location);
    // const city = body.city;
    const isDoorstepService =
      body.isDoorstepService === true || body.isDoorstepService === "true";
    const service_type = body.service_type || "one_time";
    const date = body.date;
    const start_time = body.start_time;
    const end_time = body.end_time;
    const max_participants = Number(body.max_participants || 1);
    const categoryId = body.categoryId;
    const selectedTags = tryParse(body.selectedTags) || [];
    const promoteService =
      body.promoteService === true || body.promoteService === "true";
    const promotionAmount = Number(body.amount || 0);
    const paymentMethodId = body.paymentMethodId;
    // ⭐ GET CURRENCY (service-level)
    const currency = body.currency || user.currency || "EUR";

    // ⭐ ALWAYS update user table to "last used currency"
    user.currency = currency;
    await user.save();

    // Validations
    if (!title)
      return res
        .status(400)
        .json({ isSuccess: false, message: "Title is required" });
    if (
      !location ||
      !location.name ||
      location.latitude == null ||
      location.longitude == null
    )
      return res
        .status(400)
        .json({ isSuccess: false, message: "Location is required" });
    // if (!city)
    //   return res
    //     .status(400)
    //     .json({ isSuccess: false, message: "City is required" });
    if (!categoryId)
      return res
        .status(400)
        .json({ isSuccess: false, message: "categoryId is required" });

    const category = await Category.findById(categoryId);
    if (!category)
      return res
        .status(404)
        .json({ isSuccess: false, message: "Category not found" });

    if (!Array.isArray(selectedTags) || !selectedTags.length)
      return res.status(400).json({
        isSuccess: false,
        message: "selectedTags must be a non-empty array",
      });

    const validTags = category.tags.filter((tag) =>
      selectedTags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    );
    if (!validTags.length)
      return res.status(400).json({
        isSuccess: false,
        message: "No valid tags selected from this category",
      });
    // ⭐ NEW: PAID SERVICE → CREATE CONNECTED ACCOUNT + KYC CHECK
    // ---------------------------
    if (!isFree) {
      const provider = user;

      // Step 1: Create account if not exists
      if (!provider.stripeAccountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "IT",
          email: provider.email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });

        provider.stripeAccountId = account.id;
        await provider.save();
      }

      // Step 2: Check account status
      const account = await stripe.accounts.retrieve(provider.stripeAccountId);

      // Step 3: If KYC incomplete → return onboarding link
      if (!account.charges_enabled || !account.details_submitted) {
        const link = await stripe.accountLinks.create({
          account: provider.stripeAccountId,
          refresh_url: "https://example.com/refresh",
          return_url: "https://example.com/success",
          type: "account_onboarding",
        });

        return res.status(200).json({
          isSuccess: false,
          isSuccess: true,
          message: "Please complete KYC to offer paid services.",
          onboardingUrl: link.url,
        });
      }

      // If KYC OK → allow service creation
    }

    // Build service payload
    const servicePayload = {
      title,
      description,
      Language: language,
      isFree,
      price,
      currency, // <-- NOW SAVED IN SERVICE TABLE
      location_name: location.name,
      // city,
      isDoorstepService,
      location: {
        type: "Point",
        coordinates: [Number(location.longitude), Number(location.latitude)],
      },
      category: category._id,
      tags: validTags,
      max_participants,
      service_type,
      owner: user._id,
    };

    // Handle time/date for one-time service
    if (service_type === "one_time") {
      const formattedStart = formatTimeToAMPM(start_time);
      const formattedEnd = formatTimeToAMPM(end_time);
      if (!formattedStart || !formattedEnd)
        return res.status(400).json({
          isSuccess: false,
          message: "Invalid start_time or end_time",
        });
      if (!isValidDateISO(date))
        return res.status(400).json({
          isSuccess: false,
          message: "Valid date (YYYY-MM-DD) required",
        });
      servicePayload.date = date;
      servicePayload.start_time = formattedStart;
      servicePayload.end_time = formattedEnd;
    }

    // Save base service
    const createdService = new Service(servicePayload);

    // ---- Promotion Stripe flow ----
    // if (promoteService && promotionAmount > 0) {
    //   let customerId = user.stripeCustomerId;

    //   // Create customer in Stripe if not exists
    //   if (!customerId) {
    //     const customer = await stripe.customers.create({
    //       email: user.email,
    //       name: user.name,
    //     });
    //     user.stripeCustomerId = customer.id;
    //     await user.save();
    //     customerId = customer.id;
    //     console.log("Created new Stripe customer:", customerId);
    //   }

    //   // Ensure payment method is attached
    //   if (paymentMethodId) {
    //     const existingPMs = await stripe.paymentMethods.list({
    //       customer: customerId,
    //       type: "card",
    //     });
    //     console.log(
    //       "Existing Payment Methods before attach:",
    //       existingPMs.data.map((pm) => pm.id)
    //     );

    //     const isAttached = existingPMs.data.some(
    //       (pm) => pm.id === paymentMethodId
    //     );

    //     if (!isAttached) {
    //       try {
    //         await stripe.paymentMethods.attach(paymentMethodId, {
    //           customer: customerId,
    //         });
    //         console.log(
    //           "Payment method attached successfully:",
    //           paymentMethodId
    //         );
    //       } catch (err) {
    //         console.error("Failed to attach payment method:", err);
    //         return res.status(400).json({
    //           isSuccess: false,
    //           message: "Failed to attach payment method",
    //           error: err.message,
    //         });
    //       }
    //     } else {
    //       console.log("Payment method already attached:", paymentMethodId);
    //     }

    //     // Set default payment method
    //     await stripe.customers.update(customerId, {
    //       invoice_settings: { default_payment_method: paymentMethodId },
    //     });
    //     console.log("Set default payment method:", paymentMethodId);

    //     // Create PaymentIntent
    //     const paymentIntent = await stripe.paymentIntents.create({
    //       amount: Math.round(promotionAmount * 100),
    //       currency: "inr",
    //       customer: customerId,
    //       payment_method: paymentMethodId,
    //       confirm: true,
    //       off_session: true,
    //       description: `Promotion payment for service: ${title}`,
    //     });
    //     console.log("PaymentIntent created:", paymentIntent.id);

    //     // Mark service as promoted
    //     const start = new Date();
    //     const end = new Date();
    //     end.setDate(start.getDate() + 30);

    //     createdService.isPromoted = true;
    //     createdService.promotionStart = start;
    //     createdService.promotionEnd = end;
    //     createdService.promotionBy = user._id;
    //     createdService.promotionAmount = promotionAmount;
    //     createdService.promotionPaymentId = paymentIntent.id;
    //   }
    // }

    // Save service
    await createdService.save();

    // Link to user
    user.services.push(createdService._id);
    await user.save();

    // Send notifications
    const notifiedCount = await notifyOnNewService(createdService);
    console.log(`📣 Notified ${notifiedCount} users`);

    return res.json({
      isSuccess: true,
      message: promoteService
        ? "Service created & promoted successfully 🎉"
        : "Service created successfully ✅",
      data: createdService,
    });
  } catch (err) {
    console.error("createService error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, message: "Server error", error: err.message });
  }
};

function looksLikeObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Bounding box helper
function bboxForLatLon(lat, lon, radiusKm = 3) {
  const R = 6371; // km
  const deltaLat = (radiusKm / R) * (180 / Math.PI);
  const deltaLon =
    ((radiusKm / R) * (180 / Math.PI)) / Math.cos((lat * Math.PI) / 180);
  return {
    minLat: lat - deltaLat,
    maxLat: lat + deltaLat,
    minLon: lon - deltaLon,
    maxLon: lon + deltaLon,
  };
}

// Date range helper
function dateRangeForDay(dateStr) {
  const start = new Date(dateStr + "T00:00:00.000Z");
  const end = new Date(dateStr + "T23:59:59.999Z");
  return { start, end };
}

//multiple category select
//if lat long 0,0 then visible all service
//---------------- GET SERVICES ----------------

function bboxForLatLon(lat, lon, radiusKm = 3) {
  const R = 6371; // km
  const deltaLat = (radiusKm / R) * (180 / Math.PI);
  const deltaLon =
    ((radiusKm / R) * (180 / Math.PI)) / Math.cos((lat * Math.PI) / 180);
  return {
    minLat: lat - deltaLat,
    maxLat: lat + deltaLat,
    minLon: lon - deltaLon,
    maxLon: lon + deltaLon,
  };
}
//------------------Get Service------------------
// Adjust path

/**
 * getServices controller
 *
 * Expects request body:
 * {
 *   page, limit,
 *   categoryId: [], tags: [], isFree,
 *   date,
 *   latitude, longitude, radius_km,
 *   boundingBox: { north, south, east, west }   // Option B - Google maps style (optional)
 *   keyword: ""  // keyword applies to both map & list
 * }
 */
//09-12-2025
// exports.getServices = async (req, res) => {
//   console.log("\n===== getServices called =====");
//   try {
//     console.log("Incoming Body:", JSON.stringify(req.body, null, 2));

//     const {
//       page = 1,
//       limit = 50,
//       categoryId = [],
//       date,
//       tags = [],
//       isFree,
//       latitude,
//       longitude,
//       radius_km,
//       boundingBox, // { north, south, east, west }
//       keyword = "",
//     } = req.body;

//     // parse numeric values
//     const userLat = isNaN(Number(latitude)) ? null : Number(latitude);
//     const userLng = isNaN(Number(longitude)) ? null : Number(longitude);
//     const maxRadius = radius_km ? Number(radius_km) : null;
//     const bx = boundingBox || null;
//     const pageNum = Math.max(1, Number(page) || 1);
//     const limitNum = Math.max(1, Number(limit) || 50);
//     console.log("Parsed params:", {
//       pageNum,
//       limitNum,
//       userLat,
//       userLng,
//       maxRadius,
//       boundingBox: bx,
//       keyword,
//     });

//     // -------------------------
//     // Build base mongo filter (EXCLUDING keyword and bbox/radius)
//     // We'll apply keyword and bbox in-memory (after populate) for richer matching
//     // -------------------------
//     let baseMatch = {};

//     // DATE filter -> keep same one_time / recurring logic (string dates stored as 'YYYY-MM-DD')
//     if (date) {
//       console.log("Applying date filter for:", date);
//       const endDate = new Date(date);
//       endDate.setDate(endDate.getDate() + 1);
//       baseMatch.$or = [
//         {
//           service_type: "one_time",
//           date: {
//             $gte: date,
//             $lt: new Date(endDate).toISOString().split("T")[0],
//           },
//         },
//         {
//           service_type: "recurring",
//           recurring_schedule: {
//             $elemMatch: {
//               date: {
//                 $gte: date,
//                 $lt: new Date(endDate).toISOString().split("T")[0],
//               },
//             },
//           },
//         },
//       ];
//     }

//     // CATEGORY filter
//     if (Array.isArray(categoryId) && categoryId.length > 0) {
//       console.log("Applying category filter:", categoryId);
//       baseMatch.category = { $in: categoryId };
//     }

//     // TAGS filter
//     if (Array.isArray(tags) && tags.length > 0) {
//       console.log("Applying tags filter:", tags);
//       baseMatch.tags = { $in: tags };
//     }

//     // FREE filter
//     if (isFree === true) {
//       console.log("Applying isFree=true filter");
//       baseMatch.isFree = true;
//     }

//     console.log("Base Mongo filter (no keyword/bbox):", JSON.stringify(baseMatch, null, 2));

//     // -----------------------------------------------------
//     // FETCH SERVICES FROM DB (apply baseMatch only)
//     // we populate category and owner so we can search category.name and owner fields in-memory
//     // -----------------------------------------------------
//     console.log("Querying DB with baseMatch...");
//     let services = await Service.find(baseMatch)
//       .populate("category")
//       .populate("owner", "name email profile_image")
//       .lean();

//     console.log("DB fetched services count:", services.length);

//     // -------------------------
//     // Keyword filtering (applies to map + list)
//     // We will build a safe regex and filter in JS across:
//     // title, description, tags (service), city, category.name, category.tags, owner.name, owner.email
//     // -------------------------
//     let finalServices = services;

//     if (keyword && typeof keyword === "string" && keyword.trim() !== "") {
//       const safe = (k) =>
//         k
//           .replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
//           .trim();
//       const k = safe(keyword);
//       const regex = new RegExp(k, "i");

//       console.log("Applying keyword filter (in-memory) with regex:", regex);

//       finalServices = finalServices.filter((svc) => {
//         try {
//           // title
//           if (svc.title && regex.test(String(svc.title))) return true;

//           // description
//           if (svc.description && regex.test(String(svc.description))) return true;

//           // service tags (array)
//           if (Array.isArray(svc.tags) && svc.tags.some((t) => regex.test(String(t)))) return true;

//           // city
//           if (svc.city && regex.test(String(svc.city))) return true;

//           // category name & tags
//           if (svc.category) {
//             if (svc.category.name && regex.test(String(svc.category.name))) return true;
//             if (Array.isArray(svc.category.tags) && svc.category.tags.some((t) => regex.test(String(t)))) return true;
//           }

//           // owner (user) name / email if populated
//           if (svc.owner) {
//             if (svc.owner.name && regex.test(String(svc.owner.name))) return true;
//             if (svc.owner.email && regex.test(String(svc.owner.email))) return true;
//           }

//           return false;
//         } catch (err) {
//           console.error("Keyword filter error for service id", svc._id, err);
//           return false;
//         }
//       });

//       console.log("After keyword filter count:", finalServices.length);
//     } else {
//       console.log("No keyword provided - skipping keyword filter.");
//     }

//     // -------------------------
//     // Distance calculation helper (Haversine)
//     // NOTE: service.location.coordinates is [lng, lat]
//     // -------------------------
//     const toRad = (v) => (v * Math.PI) / 180;

//     function getDistanceKm(lat1, lon1, lat2, lon2) {
//       const R = 6371;
//       const dLat = toRad(lat2 - lat1);
//       const dLon = toRad(lon2 - lon1);
//       const a =
//         Math.sin(dLat / 2) ** 2 +
//         Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
//       const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
//       return Number((R * c).toFixed(2));
//     }

//     // add distance_km to each service (if user lat/lng provided)
//     console.log("Calculating distances for services...");
//     finalServices = finalServices.map((svc) => {
//       try {
//         const coords = svc.location?.coordinates;
//         if (coords && coords.length >= 2 && userLat !== null && userLng !== null) {
//           const svcLng = Number(coords[0]);
//           const svcLat = Number(coords[1]);
//           if (!isNaN(svcLat) && !isNaN(svcLng)) {
//             svc.distance_km = getDistanceKm(userLat, userLng, svcLat, svcLng);
//           } else {
//             svc.distance_km = null;
//           }
//         } else {
//           svc.distance_km = null;
//         }
//       } catch (err) {
//         svc.distance_km = null;
//       }
//       return svc;
//     });

//     console.log("Distance calculation done.");

//     // -------------------------
//     // Map services: if boundingBox provided, filter services inside bounding box.
//     // If bbox not provided, mapServices returns ALL finalServices (no radius applied).
//     // boundingBox expected shape: { north, south, east, west }
//     // Note: service.location.coordinates = [lng, lat]
//     // -------------------------
//     console.log("Building mapServices (bounding box check) ...");
//     let mapServices = finalServices;

//     if (bx && typeof bx === "object" && bx.north != null && bx.south != null && bx.east != null && bx.west != null) {
//       console.log("Bounding box provided:", bx);
//       const north = Number(bx.north);
//       const south = Number(bx.south);
//       const east = Number(bx.east);
//       const west = Number(bx.west);

//       // Normalize if needed
//       const minLat = Math.min(north, south);
//       const maxLat = Math.max(north, south);
//       const minLng = Math.min(east, west) === east ? west : Math.min(east, west); // simpler below

//       mapServices = finalServices.filter((svc) => {
//         const coords = svc.location?.coordinates;
//         if (!coords || coords.length < 2) return false;
//         const lng = Number(coords[0]);
//         const lat = Number(coords[1]);
//         // handle wrap-around longitudes if required (simple approach)
//         const inLat = lat >= minLat && lat <= maxLat;
//         // For longitude assume east > west; if east < west (crosses antimeridian) handle accordingly
//         let inLng = false;
//         if (east >= west) {
//           inLng = lng >= west && lng <= east;
//         } else {
//           // crossing antimeridian
//           inLng = lng >= west || lng <= east;
//         }
//         return inLat && inLng;
//       });

//       console.log("mapServices after bbox filter count:", mapServices.length);
//     } else {
//       console.log("No bounding box provided — returning all finalServices in mapServices (no radius) count:", mapServices.length);
//     }

//     // -------------------------
//     // listServices: apply radius filter (if radius & user lat/lng provided), then sort and paginate
//     // If no radius provided, return full finalServices (sorted by distance if available)
//     // -------------------------
//     console.log("Building listServices (radius/pagination) ...");
//     let listCandidates = finalServices.slice(); // copy

//     if (maxRadius !== null && !isNaN(maxRadius) && userLat !== null && userLng !== null) {
//       console.log("Applying radius filter for listServices:", maxRadius, "km");
//       listCandidates = listCandidates.filter((svc) => {
//         return svc.distance_km !== null && svc.distance_km <= maxRadius;
//       });
//     } else {
//       console.log("No radius applied for listServices (either radius or user coords not provided).");
//     }

//     // Sort both mapServices and listCandidates by distance (nearest first). Null distances go to end.
//     const sortByDistance = (a, b) => {
//       if (a.distance_km === null && b.distance_km === null) return 0;
//       if (a.distance_km === null) return 1;
//       if (b.distance_km === null) return -1;
//       return a.distance_km - b.distance_km;
//     };

//     mapServices.sort(sortByDistance);
//     listCandidates.sort(sortByDistance);

//     // Pagination on listCandidates
//     const start = (pageNum - 1) * limitNum;
//     const paginated = listCandidates.slice(start, start + limitNum);

//     console.log("Final counts:", {
//       mapServices_total: mapServices.length,
//       listServices_total: listCandidates.length,
//       listServices_pageCount: paginated.length,
//     });

//     // Response: note total refers to listServices total (post-radius)
//     return res.json({
//       isSuccess: true,
//       message: "Services fetched successfully",
//       total: listCandidates.length,
//       page: pageNum,
//       limit: limitNum,
//       listServices: paginated,
//       mapServices, // full map set (subject to bbox if provided), no radius clipping
//     });
//   } catch (err) {
//     console.error("ERROR in getServices:", err);
//     return res.status(500).json({
//       isSuccess: false,
//       message: "Internal server error",
//       error: err.message,
//     });
//   }
// };
//2 exports.getServices = async (req, res) => {
//   console.log("\n===== getServices called =====");
//   try {
//     console.log("Incoming Body:", JSON.stringify(req.body, null, 2));

//     const {
//       page = 1,
//       limit = 50,
//       categoryId = [],
//       date,
//       tags = [],
//       isFree,
//       latitude,
//       longitude,
//       radius_km,
//       boundingBox,
//       keyword = "",
//       filterLat,
//       filterLng,
//     } = req.body;

//     // ==========================
//     // PARSE INPUTS
//     // ==========================
//     const userLat = Number(latitude) || null;
//     const userLng = Number(longitude) || null;

//     const cityLat =
//       filterLat && !isNaN(Number(filterLat)) ? Number(filterLat) : null;
//     const cityLng =
//       filterLng && !isNaN(Number(filterLng)) ? Number(filterLng) : null;

//     const radiusNum = !isNaN(Number(radius_km)) ? Number(radius_km) : 30;
//     const bx = boundingBox || null;

//     const pageNum = Math.max(1, Number(page));
//     const limitNum = Math.max(1, Number(limit));

//     console.log("\nParsed:", {
//       userLat,
//       userLng,
//       cityLat,
//       cityLng,
//       radiusNum,
//       boundingBox: bx,
//     });

//     // ================================
//     // BASE DB FILTER (NO LOCATION)
//     // ================================
//     let baseMatch = {};

//     // -----------------------------
//     // ⭐ DATE FILTER
//     // -----------------------------
//     if (date) {
//       console.log("Applying date filter:", date);

//       const endDate = new Date(date);
//       endDate.setDate(endDate.getDate() + 1);

//       baseMatch.$or = [
//         {
//           service_type: "one_time",
//           date: {
//             $gte: date,
//             $lt: new Date(endDate).toISOString().split("T")[0],
//           },
//         },
//         {
//           service_type: "recurring",
//           recurring_schedule: {
//             $elemMatch: {
//               date: {
//                 $gte: date,
//                 $lt: new Date(endDate).toISOString().split("T")[0],
//               },
//             },
//           },
//         },
//       ];
//     }

//     // ⭐ CATEGORY FILTER
//     if (Array.isArray(categoryId) && categoryId.length > 0) {
//       console.log("Applying category filter:", categoryId);
//       baseMatch.category = { $in: categoryId };
//     }

//     // ⭐ TAGS FILTER
//     if (Array.isArray(tags) && tags.length > 0) {
//       console.log("Applying tags filter:", tags);
//       baseMatch.tags = { $in: tags };
//     }

//     // ⭐ FREE FILTER
//     if (isFree === true) {
//       console.log("Applying isFree=true filter");
//       baseMatch.isFree = true;
//     }

//     console.log(
//       "Base Mongo filter (no keyword/bbox):",
//       JSON.stringify(baseMatch, null, 2)
//     );

//     // FETCH SERVICES
//     let services = await Service.find(baseMatch)
//       .populate("category")
//       .populate("owner", "name email profile_image")
//       .lean();

//     let finalServices = services;

//     // ================================
//     // KEYWORD FILTER
//     // ================================
//     if (keyword.trim() !== "") {
//       const regex = new RegExp(keyword.trim(), "i");
//       finalServices = finalServices.filter((svc) => {
//         return (
//           regex.test(svc.title) ||
//           regex.test(svc.description) ||
//           (svc.tags && svc.tags.some((t) => regex.test(t))) ||
//           regex.test(svc.city) ||
//           (svc.category?.name && regex.test(svc.category.name)) ||
//           (svc.owner?.name && regex.test(svc.owner.name))
//         );
//       });
//     }

//     // ===============================
//     // HAVERSINE
//     // ===============================
//     const toRad = (v) => (v * Math.PI) / 180;
//     function getDistanceKm(lat1, lon1, lat2, lon2) {
//       const R = 6371;
//       const dLat = toRad(lat2 - lat1);
//       const dLon = toRad(lon2 - lon1);
//       const a =
//         Math.sin(dLat / 2) ** 2 +
//         Math.cos(toRad(lat1)) *
//           Math.cos(toRad(lat2)) *
//           Math.sin(dLon / 2) ** 2;
//       return Number(
//         (R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2)
//       );
//     }

//     // ===============================
//     // MAP SERVICES (BOUNDING BOX ONLY)
//     // ===============================
//     let mapServices = finalServices;

//     if (
//       bx &&
//       bx.north != null &&
//       bx.south != null &&
//       bx.east != null &&
//       bx.west != null
//     ) {
//       const north = Number(bx.north);
//       const south = Number(bx.south);
//       const east = Number(bx.east);
//       const west = Number(bx.west);

//       mapServices = finalServices.filter((svc) => {
//         const coords = svc.location?.coordinates;
//         if (!coords) return false;
//         const lng = Number(coords[0]);
//         const lat = Number(coords[1]);

//         return lat >= south && lat <= north && lng >= west && lng <= east;
//       });
//     }

//     console.log("🟩 MAP SERVICES COUNT =", mapServices.length);

//     // ===============================
//     // LIST SERVICES (RADIUS FILTERING)
//     // ===============================
//     let listServices = finalServices.filter((svc) => {
//       const coords = svc.location?.coordinates;
//       if (!coords) return false;

//       const svcLng = Number(coords[0]);
//       const svcLat = Number(coords[1]);

//       // **IF CITY FILTER EXISTS → USE CITY**
//       const centerLat = cityLat !== null ? cityLat : userLat;
//       const centerLng = cityLng !== null ? cityLng : userLng;

//       if (centerLat === null || centerLng === null) return false;

//       const distFromCenter = getDistanceKm(centerLat, centerLng, svcLat, svcLng);

//       return distFromCenter <= radiusNum;
//     });

//     console.log("🟦 LIST SERVICES COUNT =", listServices.length);

//     // ===============================
//     // ADD USER DISTANCE ALWAYS
//     // ===============================
//     listServices = listServices.map((svc) => {
//       const coords = svc.location?.coordinates;
//       if (!coords) return svc;

//       const svcLng = Number(coords[0]);
//       const svcLat = Number(coords[1]);

//       if (userLat !== null && userLng !== null) {
//         svc.distance_km = getDistanceKm(userLat, userLng, svcLat, svcLng);
//       }

//       return svc;
//     });

//     // SORT BY DISTANCE
//     listServices.sort(
//       (a, b) => (a.distance_km || 999999) - (b.distance_km || 999999)
//     );

//     // PAGINATION
//     const start = (pageNum - 1) * limitNum;
//     const paginated = listServices.slice(start, start + limitNum);

//     return res.json({
//       isSuccess: true,
//       message: "Services fetched successfully",
//       total: listServices.length,
//       listServices: paginated,
//       mapServices,
//     });
//   } catch (err) {
//     console.error("ERROR in getServices:", err);
//     return res.status(500).json({
//       isSuccess: false,
//       message: "Internal server error",
//       error: err.message,
//     });
//   }
// };

// exports.getInterestedUsers = async (req, res) => {
//   try {
//     const {
//       latitude = 0,
//       longitude = 0,
//       radius_km = 10,
//       categoryId = [],
//       tags = [],
//       languages = [],
//       age,
//       keyword = "", // 🔥 added for interests keyword search
//       page = 1,
//       limit = 10,
//       userId,
//       excludeSelf = false,
//     } = req.body;

//     const skip = (parseInt(page) - 1) * parseInt(limit);

//     console.log("===== getInterestedUsers called =====");
//     console.log("Request body:", req.body);

//     // ---------- Step 1: Build interests filter ----------
//     let interestsFilter = [];

//     // 🔥 Keyword filter — match in user.interests array
//     if (keyword && typeof keyword === "string" && keyword.trim() !== "") {
//       const cleanKeyword = keyword.trim().toLowerCase();
//       interestsFilter.push(cleanKeyword);
//       console.log("Applying keyword filter:", cleanKeyword);
//     }

//     // categoryId → fetch category names + tags
//     if (Array.isArray(categoryId) && categoryId.length) {
//       const categories = await Category.find({ _id: { $in: categoryId } })
//         .select("name tags")
//         .lean();

//       categories.forEach((category) => {
//         if (category.name) interestsFilter.push(category.name.toLowerCase());
//         if (Array.isArray(category.tags)) {
//           interestsFilter.push(...category.tags.map((t) => t.toLowerCase()));
//         }
//       });
//     }

//     if (tags.length) interestsFilter.push(...tags.map((t) => t.toLowerCase()));

//     // remove duplicates
//     interestsFilter = [...new Set(interestsFilter)];
//     console.log("Final interests filter:", interestsFilter);

//     // ---------- Step 2: Build user query ----------
//     const query = {};

//     if (excludeSelf && userId) query._id = { $ne: userId };

//     // 🔥 Apply interests filter (keyword + category + tags)
//     if (interestsFilter.length) {
//       query.interests = { $in: interestsFilter };
//       console.log("Applying interests filter in query:", interestsFilter);
//     }

//     // ---------- Step 3: Language filter ----------
//     if (languages.length) {
//       const regexLanguages = languages
//         .filter((l) => typeof l === "string" && l.trim())
//         .map((l) => new RegExp(`^${l.trim()}$`, "i"));

//       if (regexLanguages.length) query.languages = { $in: regexLanguages };

//       console.log("Applying language filter:", regexLanguages);
//     }

//     // ---------- Step 4: Age filter ----------
//     if (
//       age !== undefined &&
//       age !== null &&
//       !(Array.isArray(age) && age.length === 0)
//     ) {
//       if (Array.isArray(age)) {
//         query.age = { $in: age };
//         console.log("Applying age filter (array):", age);
//       } else if (!isNaN(Number(age))) {
//         query.age = Number(age);
//         console.log("Applying age filter (single):", age);
//       }
//     } else {
//       console.log("Skipping age filter — empty or not provided:", age);
//     }

//     // ---------- Step 5: Location filter ----------
//     let calculateDistance = false;

//     if (Number(latitude) !== 0 && Number(longitude) !== 0) {
//       calculateDistance = true;
//       query["lastLocation.coords"] = {
//         $geoWithin: {
//           $centerSphere: [
//             [parseFloat(longitude), parseFloat(latitude)],
//             parseFloat(radius_km) / 6371,
//           ],
//         },
//       };
//       console.log(
//         `Applying location filter: center=[${longitude},${latitude}], radius_km=${radius_km}`
//       );
//     }

//     console.log("MongoDB user query:", JSON.stringify(query, null, 2));

//     // ---------- Step 6A: Map Users (no pagination) ----------
//     const mapUsers = await User.find(query)
//       .select("name email profile_image interests languages age lastLocation")
//       .lean();

//     // ---------- Step 6B: List Users (with pagination) ----------
//     const listUsers = await User.find(query)
//       .select("name email profile_image interests languages age lastLocation")
//       .skip(skip)
//       .limit(parseInt(limit))
//       .lean();

//     // ---------- Step 7: Distance calculation ----------
//     const addDistance = (userList) => {
//       if (!calculateDistance) return userList;

//       const toRad = (v) => (v * Math.PI) / 180;

//       return userList
//         .map((u) => {
//           if (u.lastLocation?.coords?.coordinates) {
//             const [lon2, lat2] = u.lastLocation.coords.coordinates;
//             const lat1 = parseFloat(latitude),
//               lon1 = parseFloat(longitude);
//             const R = 6371;
//             const dLat = toRad(lat2 - lat1);
//             const dLon = toRad(lon2 - lon1);
//             const a =
//               Math.sin(dLat / 2) ** 2 +
//               Math.cos(toRad(lat1)) *
//                 Math.cos(toRad(lat2)) *
//                 Math.sin(dLon / 2) ** 2;
//             const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
//             u.distance_km = Math.round(R * c * 100) / 100;
//           } else {
//             u.distance_km = null;
//           }
//           return u;
//         })
//         .sort((a, b) => (a.distance_km || 9999) - (b.distance_km || 9999));
//     };

//     const finalMapUsers = addDistance(mapUsers);
//     const finalListUsers = addDistance(listUsers);

//     // ---------- Step 8: Total count ----------
//     const total = await User.countDocuments(query);

//     // ---------- Step 9: Return response ----------
//     res.json({
//       success: true,
//       total,
//       page: parseInt(page),
//       limit: parseInt(limit),
//       mapUsers: finalMapUsers,
//       listUsers: finalListUsers,
//     });
//   } catch (err) {
//     console.error("getInterestedUsers error:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// ----------- Get All Services -------------
exports.getServices = async (req, res) => {
  console.log("\n===== getServices called =====");
  try {
    console.log("Incoming Body:", JSON.stringify(req.body, null, 2));

    const {
      page = 1,
      limit = 50,
      categoryId = [],
      date,
      tags = [],
      isFree,
      latitude,
      longitude,
      radius_km,
      boundingBox,
      keyword = "",
    } = req.body;

    const userLat = isNaN(Number(latitude)) ? null : Number(latitude);
    const userLng = isNaN(Number(longitude)) ? null : Number(longitude);
    const maxRadius = radius_km ? Number(radius_km) : null;
    const bx = boundingBox || null;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 50);

    console.log("Parsed params:", {
      pageNum,
      limitNum,
      userLat,
      userLng,
      maxRadius,
      keyword,
      boundingBox: bx
    });

    // -----------------------------
    // BASE FILTER
    // -----------------------------
    let baseMatch = {};

    if (date) {
      console.log("Applying date filter:", date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);

      baseMatch.$or = [
        {
          service_type: "one_time",
          date: {
            $gte: date,
            $lt: new Date(endDate).toISOString().split("T")[0],
          },
        },
        {
          service_type: "recurring",
          recurring_schedule: {
            $elemMatch: {
              date: {
                $gte: date,
                $lt: new Date(endDate).toISOString().split("T")[0],
              },
            },
          },
        },
      ];
    }

    if (Array.isArray(categoryId) && categoryId.length > 0) {
      baseMatch.category = { $in: categoryId };
    }

    if (Array.isArray(tags) && tags.length > 0) {
      baseMatch.tags = { $in: tags };
    }

    if (isFree === true) {
      baseMatch.isFree = true;
    }

    console.log("Base Mongo filter:", JSON.stringify(baseMatch, null, 2));

    // -----------------------------
    // FETCH FROM DB
    // -----------------------------
    let services = await Service.find(baseMatch)
      .populate("category")
      .populate("owner", "name email profile_image")
      .lean();

    console.log("DB fetched services:", services.length);

    let finalServices = services;

    // -----------------------------
    // KEYWORD FILTER
    // -----------------------------
    if (keyword.trim() !== "") {
      const safe = (k) => k.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&").trim();
      const k = safe(keyword);
      const regex = new RegExp(k, "i");

      console.log("Applying keyword filter:", regex);

      finalServices = finalServices.filter((svc) => {
        return (
          regex.test(svc.title) ||
          regex.test(svc.description) ||
          (svc.tags && svc.tags.some((t) => regex.test(String(t)))) ||
          regex.test(svc.city) ||
          (svc.category?.name && regex.test(svc.category.name)) ||
          (svc.owner?.name && regex.test(svc.owner.name)) ||
          (svc.owner?.email && regex.test(svc.owner.email))
        );
      });

      console.log("After keyword filter:", finalServices.length);
    } else {
      console.log("No keyword → skipping keyword filter");
    }

    // -----------------------------
    // DISTANCE CALCULATION
    // -----------------------------
    const toRad = (v) => (v * Math.PI) / 180;

    function getDistanceKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) ** 2;
      return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
    }

    finalServices = finalServices.map((svc) => {
      const coords = svc.location?.coordinates;
      if (coords && userLat !== null && userLng !== null) {
        svc.distance_km = getDistanceKm(userLat, userLng, Number(coords[1]), Number(coords[0]));
      } else {
        svc.distance_km = null;
      }
      return svc;
    });

    console.log("Distance calculation done.");

    // -----------------------------
    // MAP SERVICES (BOUNDING BOX)
    // -----------------------------
    let mapServices = finalServices;

    if (bx && bx.north != null) {
      console.log("Applying bounding box filter:", bx);

      mapServices = finalServices.filter((svc) => {
        const coords = svc.location?.coordinates;
        if (!coords) return false;
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);

        return lat >= bx.south && lat <= bx.north && lng >= bx.west && lng <= bx.east;
      });
    }

    console.log("Map services count:", mapServices.length);

    // -----------------------------
    // LIST SERVICES with NEW LOGIC:
    // KEYWORD → SKIP RADIUS COMPLETELY
    // -----------------------------
    let listCandidates = finalServices.slice();

    if (keyword.trim() !== "") {
      console.log("🔍 Keyword exists → SKIPPING radius filter completely");
      listCandidates = finalServices.map((svc) => svc);
    }

    else if (maxRadius !== null && !isNaN(maxRadius)) {
      console.log("📏 Applying radius filter:", maxRadius);

      listCandidates = listCandidates.filter((svc) => {
        return svc.distance_km !== null && svc.distance_km <= maxRadius;
      });

      console.log("After radius filter:", listCandidates.length);
    }

    else {
      console.log("➡️ No keyword & no radius → returning ALL");
    }

    // Sort by distance
    const sortByDistance = (a, b) => {
      if (a.distance_km === null) return 1;
      if (b.distance_km === null) return -1;
      return a.distance_km - b.distance_km;
    };

    listCandidates.sort(sortByDistance);
    mapServices.sort(sortByDistance);

    // Pagination
    const start = (pageNum - 1) * limitNum;
    const paginated = listCandidates.slice(start, start + limitNum);

    console.log("FINAL COUNTS:", {
      map_total: mapServices.length,
      list_total: listCandidates.length,
      list_page: paginated.length,
    });

    return res.json({
      isSuccess: true,
      message: "Services fetched successfully",
      total: listCandidates.length,
      page: pageNum,
      limit: limitNum,
      listServices: paginated,
      mapServices,
    });

  } catch (err) {
    console.error("ERROR in getServices:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};



exports.getInterestedUsers = async (req, res) => {
  try {
    const {
      latitude = 0,
      longitude = 0,

      filterLat,
      filterLng,

      radius_km = 10,
      categoryId = [],
      tags = [],
      languages = [],
      age,
      keyword = "",
      page = 1,
      limit = 10,
      userId,
      excludeSelf = false,
    } = req.body;

    const skip = (Number(page) - 1) * Number(limit);

    console.log("===== getInterestedUsers called =====");
    console.log("Incoming body:", req.body);

    // -----------------------------------------------------
    // STEP 1: INTEREST FILTER LOGIC (categories + tags + keyword)
    // -----------------------------------------------------
    let interestsFilter = [];

    // Keyword filter
    if (keyword.trim() !== "") {
      interestsFilter.push(keyword.trim().toLowerCase());
    }

    // Category filter
    if (Array.isArray(categoryId) && categoryId.length > 0) {
      const categories = await Category.find({ _id: { $in: categoryId } })
        .select("name tags")
        .lean();

      categories.forEach((c) => {
        if (c.name) interestsFilter.push(c.name.toLowerCase());
        if (Array.isArray(c.tags))
          interestsFilter.push(...c.tags.map((t) => t.toLowerCase()));
      });
    }

    // Tags
    if (Array.isArray(tags) && tags.length > 0) {
      interestsFilter.push(...tags.map((t) => t.toLowerCase()));
    }

    // Remove duplicates
    interestsFilter = [...new Set(interestsFilter)];

    console.log("Final interestsFilter:", interestsFilter);

    // -----------------------------------------------------
    // STEP 2: BUILD MONGO QUERY
    // -----------------------------------------------------
    const query = {};

    if (excludeSelf && userId) {
      query._id = { $ne: userId };
    }

    // Interest filter
    if (interestsFilter.length > 0) {
      query.interests = { $in: interestsFilter };
    }

    // Languages filter
    if (Array.isArray(languages) && languages.length > 0) {
      const regexLanguages = languages
        .filter((l) => typeof l === "string" && l.trim())
        .map((l) => new RegExp(`^${l.trim()}$`, "i"));

      if (regexLanguages.length > 0) {
        query.languages = { $in: regexLanguages };
      }
    }

    // Age filter
    if (Array.isArray(age) && age.length > 0) {
      query.age = { $in: age };
    } else if (!Array.isArray(age) && !isNaN(Number(age))) {
      query.age = Number(age);
    }

    // -----------------------------------------------------
    // STEP 3: LOCATION (CITY FILTER OR USER LOCATION)
    // -----------------------------------------------------

    let centerLat = null;
    let centerLng = null;

    // CASE 1 → CITY (filterLat/filterLng)
    if (filterLat && filterLng) {
      centerLat = Number(filterLat);
      centerLng = Number(filterLng);
      console.log("📌 Radius Center = CITY:", centerLat, centerLng);
    }
    // CASE 2 → USER LOCATION
    else if (latitude && longitude) {
      centerLat = Number(latitude);
      centerLng = Number(longitude);
      console.log("📌 Radius Center = USER:", centerLat, centerLng);
    }

    // Apply radius only if center exists
    if (centerLat !== null && centerLng !== null) {
      query["lastLocation.coords"] = {
        $geoWithin: {
          $centerSphere: [[centerLng, centerLat], Number(radius_km) / 6371],
        },
      };
    }

    console.log("Final Mongo Query:", JSON.stringify(query, null, 2));

    // -----------------------------------------------------
    // STEP 4: FETCH USERS
    // -----------------------------------------------------

    const mapUsers = await User.find(query)
      .select("name email profile_image interests languages age lastLocation")
      .lean();

    const listUsers = await User.find(query)
      .select("name email profile_image interests languages age lastLocation")
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // -----------------------------------------------------
    // STEP 5: ALWAYS CALCULATE DISTANCE FROM USER LOCATION
    // -----------------------------------------------------
    const addDistance = (users) => {
      const toRad = (v) => (v * Math.PI) / 180;

      return users
        .map((u) => {
          if (u.lastLocation?.coords?.coordinates) {
            const [lon2, lat2] = u.lastLocation.coords.coordinates;

            const lat1 = Number(latitude);
            const lon1 = Number(longitude);

            const R = 6371;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);

            const a =
              Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) *
                Math.cos(toRad(lat2)) *
                Math.sin(dLon / 2) ** 2;

            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            u.distance_km = Number((R * c).toFixed(2));
          } else {
            u.distance_km = null;
          }
          return u;
        })
        .sort((a, b) => (a.distance_km || 999999) - (b.distance_km || 999999));
    };

    const finalMapUsers = addDistance(mapUsers);
    const finalListUsers = addDistance(listUsers);

    // -----------------------------------------------------
    // STEP 6: TOTAL COUNT
    // -----------------------------------------------------
    const total = await User.countDocuments(query);

    // -----------------------------------------------------
    // STEP 7: RESPONSE
    // -----------------------------------------------------
    res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      mapUsers: finalMapUsers,
      listUsers: finalListUsers,
    });
  } catch (err) {
    console.error("getInterestedUsers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAllServices = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    // sort by created_at (default)
    const sortBy = req.query.sortBy || "createdAt";
    const sortDir = req.query.sortDir === "asc" ? 1 : -1;

    // total count
    const totalCount = await Service.countDocuments();

    // fetch services
    const services = await Service.find()
      .populate("category", "name") // category ka naam include hoga
      .populate("owner", "name email") // service owner details
      .sort({ [sortBy]: sortDir })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      isSuccess: true,
      message: "All services fetched successfully",
      data: {
        totalCount,
        page,
        limit,
        services,
      },
    });
  } catch (err) {
    console.error("getAllServices error:", err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};
//--------------------update service-----------------
exports.updateService = async (req, res) => {
  try {
    console.log("===== updateService (PATCH) called =====");
    console.log("Request body:", req.body);

    const { serviceId, userId, ...body } = req.body;

    if (!serviceId)
      return res
        .status(400)
        .json({ isSuccess: false, message: "serviceId is required" });
    if (!userId)
      return res
        .status(400)
        .json({ isSuccess: false, message: "userId is required" });

    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found" });

    if (!user.is_active)
      return res
        .status(403)
        .json({ isSuccess: false, message: "User is not active" });

    const service = await Service.findById(serviceId);
    if (!service)
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service not found" });

    if (String(service.owner) !== String(user._id)) {
      return res.status(403).json({
        isSuccess: false,
        message: "Not authorized to edit this service",
      });
    }

    // ✅ Build update payload dynamically
    const updatePayload = {};

    // Title
    if (body.title) updatePayload.title = String(body.title).trim();

    // Description
    if (body.description) updatePayload.description = body.description;
    if (body.isDoorstepService !== undefined) {
      updatePayload.isDoorstepService =
        body.isDoorstepService === true || body.isDoorstepService === "true";
    }

    // Price & Free
    if (body.isFree !== undefined)
      updatePayload.isFree = body.isFree === true || body.isFree === "true";
    if (body.price !== undefined) updatePayload.price = Number(body.price || 0);
    // ⭐ NEW: Currency update support
    if (body.currency) {
      updatePayload.currency = body.currency;
      user.currency = body.currency;
      await user.save();
    }

    // Language
    if (body.language || body.Language)
      updatePayload.Language = body.language || body.Language;

    // Location
    if (body.location) {
      const location = tryParse(body.location);
      if (
        location &&
        location.latitude != null &&
        location.longitude != null &&
        location.name
      ) {
        updatePayload.location_name = location.name;
        updatePayload.location = {
          type: "Point",
          coordinates: [Number(location.longitude), Number(location.latitude)],
        };
      } else {
        return res
          .status(400)
          .json({ isSuccess: false, message: "Invalid location format" });
      }
    }

    // City
    //if (body.city) updatePayload.city = body.city;

    // Category (optional now)
    if (body.categoryId) {
      const category = await Category.findById(body.categoryId);
      if (!category)
        return res
          .status(404)
          .json({ isSuccess: false, message: "Category not found" });
      updatePayload.category = category._id;

      // Tags (only if category provided)
      const selectedTags = tryParse(body.selectedTags) || [];
      const validTags = category.tags.filter((tag) =>
        selectedTags
          .map((t) => String(t).toLowerCase())
          .includes(tag.toLowerCase())
      );
      if (validTags.length) updatePayload.tags = validTags;
    }

    // Service type
    if (body.service_type)
      updatePayload.service_type = body.service_type || "one_time";

    // Date/time or recurring schedule (only if sent)
    if (body.date) updatePayload.date = String(body.date);
    if (body.start_time)
      updatePayload.start_time = body.start_time.trim().toUpperCase();
    if (body.end_time)
      updatePayload.end_time = body.end_time.trim().toUpperCase();
    if (body.recurring_schedule)
      updatePayload.recurring_schedule =
        tryParse(body.recurring_schedule) || [];

    // Max participants
    if (body.max_participants)
      updatePayload.max_participants = Number(body.max_participants);

    // ✅ Finally update
    const updatedService = await Service.findByIdAndUpdate(
      serviceId,
      { $set: updatePayload },
      { new: true }
    );
    console.log("Sending notification...");
    const notifiedCount = await notificationController.notifyOnUpdate(
      updatedService
    );
    console.log("Notification triggered");
    console.log(
      `📣 Total users notified for service "${updatedService.title}": ${notifiedCount}`
    );
    console.log("Notification process completed no errors ✅");

    return res.json({
      isSuccess: true,
      message: "Service updated successfully",
      data: updatedService,
    });
  } catch (err) {
    console.error("updateService error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, message: "Server error", error: err.message });
  }
};

//--------------------------Get Service ByID---------------------------------

// Helper to calculate distance in km between two points
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;

  const R = 6371; // Radius of Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return +(R * c).toFixed(2); // rounded to 2 decimals
}

exports.getservicbyId = async (req, res) => {
  try {
    const { serviceId, latitude, longitude, viewerId } = req.body;

    console.log("🚀 getservicbyId called with", { serviceId, viewerId });

    if (!serviceId) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "serviceId is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Invalid serviceId" });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Service not found" });
    }

    // Populate owner and category
    await service.populate(
      "owner",
      "name profile_image notifyOnProfileView fcmToken"
    );
    await service.populate("category", "name");

    console.log(`✅ Service found: ${service.title}`);
    console.log(
      `📌 Owner: ${service.owner.name}, notifyOnProfileView: ${service.owner.notifyOnProfileView}`
    );

    // Notify owner if viewerId is provided
    if (viewerId) {
      const viewer = await User.findById(viewerId).select("name profile_image");
      if (viewer) {
        console.log(
          `🚀 Sending view notification to owner for viewer ${viewerId}`
        );
        notifyOnServiceView(service, viewer).catch((err) =>
          console.error("Notification error:", err)
        );
      } else {
        console.log(`⚠️ Viewer not found: ${viewerId}`);
      }
    }

    // Calculate distance if latitude & longitude provided
    let distance_km = null;
    if (latitude && longitude && service.location?.coordinates) {
      const [lon, lat] = service.location.coordinates; // [lon, lat]
      distance_km = getDistanceKm(latitude, longitude, lat, lon);
      console.log(`📍 Calculated distance: ${distance_km.toFixed(2)} km`);
    }

    // Fetch reviews
    const reviews = await Review.find({ service: serviceId })
      .populate("user", "name profile_image")
      .sort({ created_at: -1 });

    let avgRating = 0;
    if (reviews.length > 0) {
      const total = reviews.reduce((sum, r) => sum + r.rating, 0);
      avgRating = Number((total / reviews.length).toFixed(1));
    }
    console.log(
      `⭐ Reviews fetched: ${reviews.length}, averageRating: ${avgRating}`
    );

    return res.json({
      isSuccess: true,
      message: "Service found successfully",
      data: {
        service,
        reviews,
        totalReviews: reviews.length,
        averageRating: avgRating,
        distance_km,
      },
    });
  } catch (err) {
    console.error("getservicbyId error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};
//------------------search Service------------------
exports.searchServices = async (req, res) => {
  try {
    const keyword = req.body.keyword?.trim();
    if (!keyword)
      return res.status(400).json({
        isSuccess: false,
        message: "keyword is required in body",
      });

    const regex = new RegExp(keyword, "i"); // case-insensitive

    // 1. Category match
    const matchedCategories = await Category.find({ name: regex });
    const matchedCategoryIds = matchedCategories.map((c) => c._id);

    // 2. Search in services
    const services = await Service.find({
      $or: [
        { title: regex },
        { description: regex },
        { tags: { $in: [regex] } }, // tags array match
        { category: { $in: matchedCategoryIds } },
      ],
    })
      .populate("category", "name")
      .populate("owner", "name email");

    return res.json({
      isSuccess: true,
      count: services.length,
      data: services,
    });
  } catch (err) {
    console.error("searchServices error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};
