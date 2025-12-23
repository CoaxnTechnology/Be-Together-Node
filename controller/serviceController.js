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
const streamifier = require("streamifier");
const cloudinary = require("cloudinary").v2;
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
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
function uploadBufferToCloudinary(
  buffer,
  folder = "profile_images",
  publicId = null
) {
  return new Promise((resolve, reject) => {
    const opts = {
      folder,
      resource_type: "image",
      overwrite: false,
      use_filename: false,
    };
    if (publicId) opts.public_id = publicId;

    const uploadStream = cloudinary.uploader.upload_stream(
      opts,
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
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

    // ==================================================
    // ⭐ SERVICE IMAGE LOGIC (MAIN PART)
    // ==================================================
    let serviceImage = null;
    let serviceImagePublicId = null;

    // 1️⃣ User uploaded image
    if (req.file?.buffer) {
      const uploadResult = await uploadBufferToCloudinary(
        req.file.buffer,
        "service_images"
      );

      serviceImage = uploadResult.secure_url;
      serviceImagePublicId = uploadResult.public_id;
    }
    // 2️⃣ No image → use category image
    else if (category.image) {
      serviceImage = category.image;
      serviceImagePublicId = category.imagePublicId || null;
    }
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
      image: serviceImage, // ✅ added
      imagePublicId: serviceImagePublicId, // ✅ added
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
      filterLat,
      filterLng,
      keyword = "",
    } = req.body;

    // -----------------------------
    // PARSE VALUES
    // -----------------------------
    const userLat = isNaN(Number(latitude)) ? null : Number(latitude);
    const userLng = isNaN(Number(longitude)) ? null : Number(longitude);

    const cityLat = filterLat ? Number(filterLat) : null;
    const cityLng = filterLng ? Number(filterLng) : null;

    const maxRadius = radius_km ? Number(radius_km) : null;
    const bx = boundingBox || null;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));

    console.log("\nParsed Params:", {
      userLat,
      userLng,
      cityLat,
      cityLng,
      maxRadius,
      keyword,
    });

    // -----------------------------
    // BASE MONGO FILTER
    // -----------------------------
    let baseMatch = {};

    if (date) {
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

    if (categoryId?.length) {
      baseMatch.category = { $in: categoryId };
    }

    if (tags?.length) {
      baseMatch.tags = { $in: tags };
    }

    if (isFree === true) {
      baseMatch.isFree = true;
    }

    console.log("\nBase Mongo Filter:", JSON.stringify(baseMatch, null, 2));

    // -----------------------------
    // FETCH DATABASE SERVICES
    // -----------------------------
    let services = await Service.find(baseMatch)
      .populate("category")
      .populate("owner", "name email profile_image")
      .lean();

    console.log("DB Services Count:", services.length);

    let finalServices = services;

    // -----------------------------
    // KEYWORD FILTER

    if (keyword.trim() !== "") {
      const raw = keyword.trim();

      // SAFE ESCAPE (does NOT escape space)
      const safe = raw.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");

      const regex = new RegExp(safe, "i");

      console.log("Applying Keyword Filter:", regex);

      finalServices = finalServices.filter((svc) => {
        return (
          regex.test(svc.title || "") ||
          regex.test(svc.description || "") ||
          // service.tags search
          (svc.tags && svc.tags.some((t) => regex.test(String(t)))) ||
          // category.tags search
          (svc.category?.tags &&
            svc.category.tags.some((t) => regex.test(String(t)))) ||
          // 👉 NEW: location_name search
          regex.test(svc.location_name || "") ||
          // city search
          regex.test(svc.city || "") ||
          // category name
          (svc.category?.name && regex.test(String(svc.category.name))) ||
          // owner info
          (svc.owner?.name && regex.test(String(svc.owner.name))) ||
          (svc.owner?.email && regex.test(String(svc.owner.email)))
        );
      });

      console.log("After Keyword Filter:", finalServices.length);
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
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

      return Number(
        (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2)
      );
    }

    finalServices = finalServices.map((svc) => {
      const coords = svc.location?.coordinates;
      if (coords && userLat !== null && userLng !== null) {
        svc.distance_km = getDistanceKm(
          userLat,
          userLng,
          Number(coords[1]),
          Number(coords[0])
        );
      } else {
        svc.distance_km = null;
      }
      return svc;
    });

    // -----------------------------
    // MAP SERVICES (BOUNDING BOX)
    // -----------------------------
    let mapServices = finalServices;

    if (bx && bx.north != null) {
      console.log("\nApplying Bounding Box:", bx);

      mapServices = finalServices.filter((svc) => {
        const coords = svc.location?.coordinates;
        if (!coords) return false;

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);

        return (
          lat >= bx.south && lat <= bx.north && lng >= bx.west && lng <= bx.east
        );
      });
    }

    console.log("Map Services Count:", mapServices.length);

    // -----------------------------
    // LIST SERVICES — SMART RADIUS LOGIC
    // -----------------------------
    let listCandidates = finalServices.slice();

    /** ----------------------------------------
     * CASE 1: KEYWORD EXISTS → SKIP RADIUS
     * -------------------------------------- **/
    if (keyword.trim() !== "") {
      console.log("🔍 Keyword detected → SKIPPING radius completely");
      // return all keyword matches
      listCandidates = finalServices;
    } else {
      /** ----------------------------------------
       * CASE 2: NO KEYWORD → APPLY RADIUS
       * -------------------------------------- **/
      let centerLat = null;
      let centerLng = null;

      if (cityLat !== null && cityLng !== null) {
        console.log("📌 Radius Center = CITY:", cityLat, cityLng);
        centerLat = cityLat;
        centerLng = cityLng;
      } else if (userLat !== null && userLng !== null) {
        console.log("📌 Radius Center = USER:", userLat, userLng);
        centerLat = userLat;
        centerLng = userLng;
      }

      if (centerLat !== null && centerLng !== null && maxRadius !== null) {
        console.log("📏 Applying Radius:", maxRadius, "KM");

        listCandidates = listCandidates.filter((svc) => {
          const coords = svc.location?.coordinates;
          if (!coords) return false;

          const dist = getDistanceKm(
            centerLat,
            centerLng,
            Number(coords[1]),
            Number(coords[0])
          );
          return dist <= maxRadius;
        });

        console.log("After Radius Filter:", listCandidates.length);
      } else {
        console.log("➡️ No radius applied (no center provided)");
      }
    }

    // -----------------------------
    // SORT + PAGINATION
    // -----------------------------
    listCandidates.sort((a, b) => {
      if (a.distance_km === null) return 1;
      if (b.distance_km === null) return -1;
      return a.distance_km - b.distance_km;
    });

    mapServices.sort((a, b) => {
      if (a.distance_km === null) return 1;
      if (b.distance_km === null) return -1;
      return a.distance_km - b.distance_km;
    });

    const start = (pageNum - 1) * limitNum;
    const paginated = listCandidates.slice(start, start + limitNum);

    console.log("\nFINAL COUNTS:", {
      total_list: listCandidates.length,
      total_map: mapServices.length,
      page_items: paginated.length,
    });

    // -----------------------------
    // RESPONSE
    // -----------------------------
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

    console.log("\n===== getInterestedUsers called =====");
    console.log("Incoming body:", req.body);

    // -----------------------------------------------------
    // STEP 1: INTEREST FILTER LOGIC
    // -----------------------------------------------------
    let interestsFilter = [];

    // Keyword
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

    interestsFilter = [...new Set(interestsFilter)];

    console.log("Final interestsFilter:", interestsFilter);

    // -----------------------------------------------------
    // STEP 2: BUILD MONGO QUERY
    // -----------------------------------------------------
    const query = {};

    if (excludeSelf && userId) {
      query._id = { $ne: userId };
    }

    // interests filter
    if (interestsFilter.length > 0) {
      query.interests = { $in: interestsFilter };
    }

    // languages filter
    if (Array.isArray(languages) && languages.length > 0) {
      const regexLanguages = languages
        .filter((l) => typeof l === "string" && l.trim())
        .map((l) => new RegExp(`^${l.trim()}$`, "i"));

      if (regexLanguages.length > 0) {
        query.languages = { $in: regexLanguages };
      }
    }

    // age filter
    if (Array.isArray(age) && age.length > 0) {
      query.age = { $in: age };
    } else if (!Array.isArray(age) && !isNaN(Number(age))) {
      query.age = Number(age);
    }

    // -----------------------------------------------------
    // STEP 3: LOCATION / RADIUS LOGIC WITH KEYWORD SKIP
    // -----------------------------------------------------
    let centerLat = null;
    let centerLng = null;

    // CASE 1 → CITY SELECTED
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

    // ⭐ NEW: If keyword exists → DO NOT APPLY RADIUS
    if (keyword.trim() !== "") {
      console.log("🔍 Keyword exists → SKIPPING RADIUS FILTER COMPLETELY.");
    }

    // Apply radius only when NO keyword
    else if (centerLat !== null && centerLng !== null) {
      console.log("📏 Applying radius filter:", radius_km, "km");

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

    console.log("Fetched mapUsers:", mapUsers.length);
    console.log("Fetched listUsers:", listUsers.length);

    // -----------------------------------------------------
    // STEP 5: DISTANCE CALCULATOR
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
    // STEP 6: COUNT
    // -----------------------------------------------------
    const total = await User.countDocuments(query);

    console.log("Total matched users:", total);

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
    // =========================
    // 🖼 IMAGE UPDATE LOGIC
    // =========================
    if (req.file && req.file.buffer) {
      // ✅ CASE 1: New image uploaded
      console.log("Uploading new service image...");

      if (service.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(service.imagePublicId);
        } catch (err) {
          console.log("Old image delete failed:", err.message);
        }
      }

      const uploadResult = await uploadBufferToCloudinary(
        req.file.buffer,
        "service_images"
      );

      updatePayload.image = uploadResult.secure_url;
      updatePayload.imagePublicId = uploadResult.public_id;
    } else if (body.removeImage === true || body.removeImage === "true") {
      // ✅ CASE 3: Image removed → fallback to category image
      console.log("Image removed, setting category image");

      if (service.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(service.imagePublicId);
        } catch (err) {
          console.log("Old image delete failed:", err.message);
        }
      }
      const serviceCategory = await Category.findById(service.category);
      updatePayload.image = serviceCategory?.image || null;
      updatePayload.imagePublicId = serviceCategory?.imagePublicId || null;
    }

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
//-------------------delete service-----------------
const Booking = require("../model/Booking");
const { sendServiceDeleteApprovedEmail } = require("../utils/email");

exports.deleteService = async (req, res) => {
  try {
    const userId = req.user.id; // owner
    const { serviceId } = req.body; // 👈 BODY se aayega

    if (!serviceId) {
      return res.status(400).json({
        isSuccess: false,
        message: "serviceId is required",
      });
    }

    const service = await Service.findById(serviceId);
    if (!service)
      return res.status(404).json({
        isSuccess: false,
        message: "Service not found",
      });

    // ✅ Only owner can delete
    if (service.owner.toString() !== userId) {
      return res.status(403).json({
        isSuccess: false,
        message: "You are not allowed to delete this service",
      });
    }

    // 🔍 Check if any booking exists
    const bookingExists = await Booking.findOne({
      service: serviceId,
      status: { $in: ["booked", "started", "completed"] },
    });

    // ================================
    // CASE 1: No booking → Direct delete
    // ================================
    if (!bookingExists) {
      await Service.findByIdAndDelete(serviceId);
      return res.json({
        isSuccess: true,
        message: "Service deleted successfully ✅",
      });
    }

    // ==================================
    // CASE 2: Booking exists → Admin approval
    // ==================================
    service.isDeleteRequested = true;
    service.deleteRequestedAt = new Date();
    await service.save();

    return res.json({
      isSuccess: true,
      message:
        "Service has bookings. Delete request sent to admin for approval ⏳",
    });
  } catch (err) {
    console.error("deleteService error:", err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};

//-----------------admin aproval-------------
exports.approveServiceDelete = async (req, res) => {
  console.log("🚀 [ADMIN APPROVE DELETE] API CALLED");

  try {
    const { serviceId } = req.params;
    console.log("🆔 Service ID:", serviceId);

    // ===============================
    // 1️⃣ Fetch service + owner
    // ===============================
    console.log("🔍 Fetching service from DB...");
    const service = await Service.findById(serviceId).populate(
      "owner",
      "name email fcmToken"
    );

    if (!service) {
      console.log("❌ Service NOT FOUND");
      return res.status(404).json({
        isSuccess: false,
        message: "Service not found",
      });
    }

    console.log("✅ Service found:", service.title);
    console.log("👤 Provider:", service.owner?.name, service.owner?.email);

    if (!service.isDeleteRequested) {
      console.log("⚠️ Delete request NOT found for this service");
      return res.status(400).json({
        isSuccess: false,
        message: "No delete request for this service",
      });
    }

    console.log("📌 Delete request exists → proceeding");

    // ===============================
    // 2️⃣ Fetch bookings + customers
    // ===============================
    console.log("🔍 Fetching bookings for this service...");
    const bookings = await Booking.find({
      service: serviceId,
      status: { $in: ["booked", "started"] },
    }).populate("customer", "name email fcmToken");

    console.log(`📦 Total bookings found: ${bookings.length}`);

    // ===============================
    // 📧 EMAIL → CUSTOMERS
    // ===============================
    console.log("📧 Sending EMAILS to CUSTOMERS...");

    for (const booking of bookings) {
      if (!booking.customer) {
        console.log("⚠️ Booking has NO customer, skipping");
        continue;
      }

      console.log(
        `📨 Sending email to CUSTOMER: ${booking.customer.name} (${booking.customer.email})`
      );

      try {
        await sendServiceDeleteApprovedEmail(
          booking.customer,
          service,
          "customer"
        );
        console.log("✅ Customer email SENT");
      } catch (emailErr) {
        console.log(
          "❌ Customer email FAILED:",
          booking.customer.email,
          emailErr.message
        );
      }
    }

    // ===============================
    // 📧 EMAIL → PROVIDER
    // ===============================
    console.log(
      `📧 Sending email to PROVIDER: ${service.owner.name} (${service.owner.email})`
    );

    try {
      await sendServiceDeleteApprovedEmail(
        service.owner,
        service,
        "provider"
      );
      console.log("✅ Provider email SENT");
    } catch (emailErr) {
      console.log(
        "❌ Provider email FAILED:",
        service.owner.email,
        emailErr.message
      );
    }

    // ===============================
    // 🔔 FIREBASE NOTIFICATIONS
    // ===============================
    console.log("🔔 Sending FIREBASE notifications...");

    try {
      await notificationController.notifyOnServiceDeleteApproved(
        service,
        bookings
      );
      console.log("✅ Firebase notifications SENT");
    } catch (notifyErr) {
      console.log(
        "❌ Firebase notification FAILED:",
        notifyErr.message
      );
    }

    // ===============================
    // ✅ MARK APPROVED
    // ===============================
    console.log("✅ Marking deleteApprovedByAdmin = true");
    service.deleteApprovedByAdmin = true;
    await service.save();
    console.log("💾 Service approval status saved");

    // ===============================
    // 🔥 DELETE SERVICE
    // ===============================
    console.log("🔥 Deleting service from DB...");
    await Service.findByIdAndDelete(serviceId);
    console.log("🗑️ Service DELETED successfully");

    console.log("🎉 ADMIN DELETE FLOW COMPLETED SUCCESSFULLY");

    return res.json({
      isSuccess: true,
      message:
        "Service deleted. Customers & provider notified via email and notification ✅",
    });
  } catch (err) {
    console.error("❌ approveServiceDelete FATAL ERROR:", err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};


exports.getDeleteServiceRequests = async (req, res) => {
  try {
    const requests = await Service.find({
      isDeleteRequested: true,
      deleteApprovedByAdmin: false,
    })
      .populate("owner", "name email")
      .populate("category", "name")
      .select(
        "title price currency isFree location_name owner category createdAt deleteRequestedAt"
      )
      .sort({ deleteRequestedAt: -1 })
      .lean();

    return res.json({
      isSuccess: true,
      total: requests.length,
      data: requests,
    });
  } catch (err) {
    res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
exports.rejectServiceDelete = async (req, res) => {
  try {
    const { serviceId } = req.params;

    const service = await Service.findById(serviceId);
    if (!service)
      return res.status(404).json({
        isSuccess: false,
        message: "Service not found",
      });

    service.isDeleteRequested = false;
    service.deleteRequestedAt = null;
    await service.save();

    return res.json({
      isSuccess: true,
      message: "Delete request rejected",
    });
  } catch (err) {
    res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
