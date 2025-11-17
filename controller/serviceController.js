const moment = require("moment");
const User = require("../model/User");
const Category = require("../model/Category");
const Service = require("../model/Service");
const mongoose = require("mongoose");
const notificationController = require("./notificationController");
const { notifyOnNewService } = require("./notificationController");
const { notifyOnServiceView } = require("./notificationController");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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

exports.getServices = async (req, res) => {
  try {
    const q = { ...req.query, ...req.body };
    console.log("Incoming query/body:", q);

    // ----- CATEGORY -----
    let categoryId = q.categoryId || null;
    if (categoryId && typeof categoryId === "string") {
      try {
        categoryId = JSON.parse(categoryId);
      } catch {
        // keep string as-is
      }
    }

    // ----- TAGS -----
    const tags = Array.isArray(q.tags) ? q.tags : q.tags ? [q.tags] : [];

    // ----- PAGINATION -----
    const page = Math.max(1, Number(q.page || 1));
    const limit = Math.min(100, Number(q.limit || 20));
    const skip = (page - 1) * limit;

    // ----- RADIUS -----
    const radiusKm = q.radius_km !== undefined ? Number(q.radius_km) : 10;

    // ----- MATCH FILTER -----
    const match = {};

    if (Array.isArray(categoryId) && categoryId.length > 0) {
      match.category = { $in: categoryId.map((id) => new Types.ObjectId(id)) };
    } else if (
      categoryId &&
      typeof categoryId === "string" &&
      categoryId.trim() !== ""
    ) {
      match.category = new Types.ObjectId(categoryId);
    }

    if (tags.length) match.tags = { $in: tags };

    if (q.isFree === true || q.isFree === "true") match.isFree = true;
    else if (q.isFree === false || q.isFree === "false") match.isFree = false;

    let excludeOwnerId = q.excludeOwnerId || (req.user && req.user._id);
    if (excludeOwnerId)
      match.owner = { $ne: new Types.ObjectId(excludeOwnerId) };

    if (q.date) {
      const queryDate = new Date(q.date);
      match.$or = [
        { service_type: "one_time", date: queryDate },
        { service_type: "recurring", "recurring_schedule.date": queryDate },
      ];
    }

    // ----- LOCATION -----
    let refLat = null;
    let refLon = null;
    if (req.user?.lastLocation?.coords?.coordinates) {
      const coords = req.user.lastLocation.coords.coordinates;
      if (Array.isArray(coords) && coords.length === 2) {
        refLon = coords[0];
        refLat = coords[1];
      }
    }
    if ((refLat === null || refLon === null) && q.latitude && q.longitude) {
      refLat = Number(q.latitude);
      refLon = Number(q.longitude);
    }

    // ---------- PIPELINE BASE ----------
    const buildPipeline = (withPagination = false) => {
      const pipeline = [];

      if (refLat != null && refLon != null) {
        pipeline.push({
          $geoNear: {
            near: { type: "Point", coordinates: [refLon, refLat] },
            distanceField: "distance_km",
            spherical: true,
            maxDistance: radiusKm * 1000,
            distanceMultiplier: 0.001,
          },
        });
        pipeline.push({
          $addFields: { distance_km: { $round: ["$distance_km", 2] } },
        });
      }

      pipeline.push({ $match: match });

      pipeline.push(
        {
          $lookup: {
            from: "categories",
            localField: "category",
            foreignField: "_id",
            as: "category",
          },
        },
        { $unwind: "$category" },
        {
          $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "owner",
          },
        },
        { $unwind: "$owner" },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [
                "$$ROOT",
                {
                  owner: {
                    _id: "$owner._id",
                    profile_image: "$owner.profile_image",
                    name: "$owner.name",
                  },
                },
              ],
            },
          },
        },
        {
          $lookup: {
            from: "reviews",
            let: { serviceId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$service", "$$serviceId"] } } },
              {
                $lookup: {
                  from: "users",
                  localField: "user",
                  foreignField: "_id",
                  as: "user",
                },
              },
              { $unwind: "$user" },
              {
                $project: {
                  _id: 1,
                  rating: 1,
                  text: 1,
                  created_at: 1,
                  "user.name": 1,
                  "user.email": 1,
                  "user.profile_image": 1,
                },
              },
            ],
            as: "reviews",
          },
        },
        {
          $addFields: {
            averageRating: { $avg: "$reviews.rating" },
            totalReviews: { $size: "$reviews" },
          },
        }
      );

      if (withPagination) {
        pipeline.push({ $skip: skip }, { $limit: limit });
      }

      return pipeline;
    };

    // ---------- Fetch Services ----------
    const listServices = await Service.aggregate(buildPipeline(true));
    const mapServices = await Service.aggregate(buildPipeline(false));

    // ---------- Total Count ----------
    const totalCountPipeline = buildPipeline(false);
    totalCountPipeline.push({ $count: "total" });
    const totalCountResult = await Service.aggregate(totalCountPipeline);
    const totalCount = totalCountResult[0]?.total || 0;

    return res.json({
      isSuccess: true,
      message: "Services fetched successfully",
      total: totalCount,
      page,
      limit,
      listServices, // for list with pagination
      mapServices, // for map without pagination
    });
  } catch (err) {
    console.error("getServices error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};

exports.getInterestedUsers = async (req, res) => {
  try {
    const {
      latitude = 0,
      longitude = 0,
      radius_km = 10,
      categoryId = [], // can be empty array
      tags = [],
      languages = [], // array of languages
      age, // exact age filter
      page = 1,
      limit = 10,
      userId,
      excludeSelf = false,
    } = req.body;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log("===== getInterestedUsers called =====");
    console.log("Request body:", req.body);

    // ---------- Step 1: Build interests filter ----------
    let interestsFilter = [];

    if (Array.isArray(categoryId) && categoryId.length) {
      const categories = await Category.find({ _id: { $in: categoryId } })
        .select("name tags")
        .lean();

      if (!categories.length) {
        return res
          .status(404)
          .json({ success: false, message: "Category not found" });
      }

      categories.forEach((category) => {
        if (category.name) interestsFilter.push(category.name.toLowerCase());
        if (Array.isArray(category.tags)) {
          interestsFilter.push(...category.tags.map((t) => t.toLowerCase()));
        }
      });
    }

    if (tags.length) interestsFilter.push(...tags.map((t) => t.toLowerCase()));

    // Remove duplicates
    interestsFilter = [...new Set(interestsFilter)];
    console.log("Final interests filter:", interestsFilter);

    // ---------- Step 2: Build user query ----------
    const query = {};

    if (excludeSelf && userId) query._id = { $ne: userId };
    if (interestsFilter.length) query.interests = { $in: interestsFilter };

    // ---------- Step 3: Language filter ----------
    if (languages.length) {
      const regexLanguages = languages
        .filter((l) => typeof l === "string" && l.trim())
        .map((l) => new RegExp(`^${l.trim()}$`, "i"));

      if (regexLanguages.length) {
        query.languages = { $in: regexLanguages };
      }

      console.log("Applying language filter:", regexLanguages);
    }

    // ---------- Step 4: Age filter ----------
    const validAge = Number(age);
    if (!isNaN(validAge) && age !== "" && age !== null && age !== undefined) {
      query.age = validAge;
      console.log("Applying age filter:", validAge);
    } else {
      console.log("Skipping age filter — invalid or empty age:", age);
    }

    // ---------- Step 5: Location filter ----------
    let calculateDistance = false;
    if (Number(latitude) !== 0 && Number(longitude) !== 0) {
      calculateDistance = true;
      query["lastLocation.coords"] = {
        $geoWithin: {
          $centerSphere: [
            [parseFloat(longitude), parseFloat(latitude)],
            parseFloat(radius_km) / 6371,
          ],
        },
      };
      console.log(
        `Applying location filter: center=[${longitude},${latitude}], radius_km=${radius_km}`
      );
    }

    console.log("MongoDB user query:", JSON.stringify(query, null, 2));

    // ---------- Step 6A: Map Users (no pagination) ----------
    const mapUsers = await User.find(query)
      .select("name email profile_image interests languages age lastLocation")
      .lean();

    // ---------- Step 6B: List Users (with pagination) ----------
    const listUsers = await User.find(query)
      .select("name email profile_image interests languages age lastLocation")
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // ---------- Step 7: Distance calculation ----------
    const addDistance = (userList) => {
      if (!calculateDistance) return userList;
      const toRad = (v) => (v * Math.PI) / 180;

      return userList
        .map((u) => {
          if (u.lastLocation?.coords?.coordinates) {
            const [lon2, lat2] = u.lastLocation.coords.coordinates;
            const lat1 = parseFloat(latitude),
              lon1 = parseFloat(longitude);
            const R = 6371;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a =
              Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) *
                Math.cos(toRad(lat2)) *
                Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            u.distance_km = Math.round(R * c * 100) / 100;
          } else {
            u.distance_km = null;
          }
          return u;
        })
        .sort((a, b) => (a.distance_km || 9999) - (b.distance_km || 9999));
    };

    const finalMapUsers = addDistance(mapUsers);
    const finalListUsers = addDistance(listUsers);

    // ---------- Step 8: Total count ----------
    const total = await User.countDocuments(query);

    // ---------- Step 9: Return response ----------
    res.json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      mapUsers: finalMapUsers,
      listUsers: finalListUsers,
    });
  } catch (err) {
    console.error("getInterestedUsers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ----------- Get All Services -------------
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
