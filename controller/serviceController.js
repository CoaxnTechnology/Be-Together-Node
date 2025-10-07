const moment = require("moment");
const User = require("../model/User");
const Category = require("../model/Category");
const Service = require("../model/Service");
const mongoose = require("mongoose");
const notificationController = require("./notificationController");
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

// Create service API
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

    const body = req.body;
    const title = body.title && String(body.title).trim();
    const description = body.description || "";
    const language = body.language || body.Language || "English";
    const isFree = body.isFree === true || body.isFree === "true";
    const price = isFree ? 0 : Number(body.price || 0);

    const location = tryParse(body.location);
    // const city = body.city;
    const service_type = body.service_type || "one_time";
    const date = body.date;
    const start_time = body.start_time;
    const end_time = body.end_time;
    const max_participants = Number(body.max_participants || 1);
    const categoryId = body.categoryId;
    const selectedTags = tryParse(body.selectedTags) || [];

    // ---- Validation ----
    if (!title)
      return res
        .status(400)
        .json({ isSuccess: false, message: "Title is required" });

    if (
      !location ||
      !location.name ||
      location.latitude == null ||
      location.longitude == null
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: "Location (name, latitude, longitude) is required",
      });
    }

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

    if (!Array.isArray(selectedTags) || !selectedTags.length) {
      return res.status(400).json({
        isSuccess: false,
        message: "selectedTags must be a non-empty array",
      });
    }

    const validTags = category.tags.filter((tag) =>
      selectedTags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    );
    if (!validTags.length)
      return res.status(400).json({
        isSuccess: false,
        message: "No valid tags selected from this category",
      });

    // ---- Build payload ----
    const servicePayload = {
      title,
      description,
      Language: language,
      isFree,
      price,
      location_name: location.name, // ✅ save location name
      //  city, // ✅ save city
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

    // One-time service
    if (service_type === "one_time") {
      const formattedStart = formatTimeToAMPM(start_time);
      const formattedEnd = formatTimeToAMPM(end_time);

      if (!formattedStart || !formattedEnd) {
        return res.status(400).json({
          isSuccess: false,
          message:
            "Invalid start_time or end_time (must be HH:mm or hh:mm AM/PM)",
        });
      }

      if (!isValidDateISO(date)) {
        return res.status(400).json({
          isSuccess: false,
          message: "Valid date (YYYY-MM-DD) required for one_time",
        });
      }

      servicePayload.date = date;
      servicePayload.start_time = formattedStart;
      servicePayload.end_time = formattedEnd;
    }

    // Recurring service
    if (service_type === "recurring") {
      const recurring_schedule = tryParse(body.recurring_schedule) || [];
      if (!Array.isArray(recurring_schedule) || !recurring_schedule.length) {
        return res.status(400).json({
          isSuccess: false,
          message: "Recurring schedule is required for recurring services",
        });
      }

      servicePayload.recurring_schedule = recurring_schedule.map((item) => {
        const formattedStart = formatTimeToAMPM(item.start_time);
        const formattedEnd = formatTimeToAMPM(item.end_time);

        if (
          !item.day ||
          !isValidDateISO(item.date) ||
          !formattedStart ||
          !formattedEnd
        ) {
          throw new Error(
            "Each recurring schedule item must include day, date, start_time, end_time in HH:mm or hh:mm AM/PM format"
          );
        }

        return {
          day: item.day,
          date: item.date,
          start_time: formattedStart,
          end_time: formattedEnd,
        };
      });
    }

    // ---- Save service ----
    const createdService = new Service(servicePayload);
    await createdService.save();

    // Link service to user
    user.services.push(createdService._id);
    await user.save();

    console.log("Service created successfully:", createdService._id);
    notificationController.notifyOnNewService(createdService);

    return res.json({
      isSuccess: true,
      message: "Service created successfully",
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
exports.getServices = async (req, res) => {
  try {
    const q = { ...req.query, ...req.body };

    let categoryId = q.categoryId || null;
    if (categoryId && typeof categoryId === "string") {
      try {
        categoryId = JSON.parse(categoryId);
      } catch {}
    }

    const tags = Array.isArray(q.tags) ? q.tags : q.tags ? [q.tags] : [];
    const radiusKm = q.radius_km !== undefined ? Number(q.radius_km) : 10;
    const page = Math.max(1, Number(q.page || 1));
    const limit = Math.min(100, Number(q.limit || 20));
    const skip = (page - 1) * limit;

    const match = {};

    // CATEGORY FILTER
    if (Array.isArray(categoryId) && categoryId.length > 0) {
      match.category = { $in: categoryId };
    } else if (
      categoryId &&
      typeof categoryId === "string" &&
      categoryId.trim() !== ""
    ) {
      match.category = categoryId;
    }

    // TAGS FILTER
    if (tags.length) match.tags = { $in: tags };

    // FREE / PAID FILTER
    if (q.isFree === true || q.isFree === "true") match.isFree = true;
    else if (q.isFree === false || q.isFree === "false") match.isFree = false;

    // EXCLUDE OWNER
    let excludeOwnerId = q.excludeOwnerId || (req.user && req.user._id);
    if (excludeOwnerId) match.owner = { $ne: excludeOwnerId };

    // DATE FILTER
    if (q.date) {
      match.$or = [
        { service_type: "one_time", date: q.date },
        { service_type: "recurring", "recurring_schedule.date": q.date },
      ];
    }

    // LOCATION
    let refLat = null;
    let refLon = null;

    if (req.user?.lastLocation?.coords?.coordinates) {
      const coords = req.user.lastLocation.coords.coordinates;
      if (
        Array.isArray(coords) &&
        coords.length === 2 &&
        !(coords[0] === 0 && coords[1] === 0)
      ) {
        refLon = coords[0];
        refLat = coords[1];
      }
    }
    if ((refLat === null || refLon === null) && q.latitude && q.longitude) {
      refLat = Number(q.latitude);
      refLon = Number(q.longitude);
    }

    // --- AGGREGATION PIPELINE ---
    const pipeline = [];

    // ✅ Geo filter with proper distance in KM
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

      // Convert to km and round 2 decimal
      pipeline.push({
        $addFields: {
          distance_km: { $round: ["$distance_km", 2] },
        },
      });
    }

    // MATCH
    pipeline.push({ $match: match });

    // LOOKUP CATEGORY
    pipeline.push(
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: "$category" }
    );

    // LOOKUP OWNER (only id + profile_image)
    pipeline.push(
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
                },
              },
            ],
          },
        },
      }
    );

    // LOOKUP REVIEWS
    pipeline.push(
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

    // PAGINATION
    pipeline.push({ $skip: skip }, { $limit: limit });

    const services = await Service.aggregate(pipeline);

    // COUNT
    const totalCountPipeline = pipeline.filter(
      (stage) => !stage.$skip && !stage.$limit
    );
    const totalCountResult = await Service.aggregate([
      ...totalCountPipeline,
      { $count: "total" },
    ]);
    const totalCount = totalCountResult[0] ? totalCountResult[0].total : 0;

    return res.json({
      isSuccess: true,
      message: "Services fetched successfully",
      data: { totalCount, page, limit, services },
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
      categoryId,
      tags = [],
      languages = [], // array of languages to filter
      age,           // exact age to filter
      page = 1,
      limit = 10,
      userId,
      excludeSelf = false,
    } = req.body;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // ---------- Step 1: Build interests filter ----------
    let interestsFilter = [];

    if (categoryId) {
      const category = await Category.findById(categoryId)
        .select("name tags")
        .lean();
      if (category) {
        if (category.name) interestsFilter.push(category.name.toLowerCase());
        if (Array.isArray(category.tags)) interestsFilter.push(...category.tags.map(t => t.toLowerCase()));
      }
    }

    if (tags.length) interestsFilter.push(...tags.map(t => t.toLowerCase()));

    interestsFilter = [...new Set(interestsFilter)];

    // ---------- Step 2: Build user query ----------
    const query = {};

    if (excludeSelf && userId) query._id = { $ne: userId };

    if (interestsFilter.length) query.interests = { $in: interestsFilter };

    // ---------- Step 3: Language filter ----------
    if (languages.length) query.languages = { $in: languages.map(l => l.toLowerCase()) };

    // ---------- Step 4: Age filter ----------
    if (age !== undefined) query.age = parseInt(age);

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
    }

    // ---------- Step 6: Fetch users ----------
    let users = await User.find(query)
      .select("name email profile_image interests languages age lastLocation")
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // ---------- Step 7: Distance calculation ----------
    if (calculateDistance) {
      const toRad = (v) => (v * Math.PI) / 180;
      users.forEach((u) => {
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
      });
      users.sort((a, b) => (a.distance_km || 9999) - (b.distance_km || 9999));
    }

    // ---------- Step 8: Total count ----------
    const total = await User.countDocuments(query);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      users,
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
    if (body.city) updatePayload.city = body.city;

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

    notificationController.notifyOnUpdate(updatedService);

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
    const { serviceId, latitude, longitude } = req.body;

    if (!serviceId) {
      return res.status(400).json({
        isSuccess: false,
        message: "serviceId is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid serviceId",
      });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        isSuccess: false,
        message: "Service not found",
      });
    }

    // Populate owner and category
    await service.populate("owner", "name profile_image");
    await service.populate("category", "name");

    // Calculate distance if user's location is provided
    let distance_km = null;
    if (latitude && longitude && service.location?.coordinates) {
      const [lon, lat] = service.location.coordinates; // [lon, lat]
      distance_km = getDistanceKm(latitude, longitude, lat, lon);
    }

    // Fetch reviews
    const reviews = await Review.find({ service: serviceId })
      .populate("user", "name profile_image")
      .sort({ created_at: -1 });

    // Calculate average rating
    let avgRating = 0;
    if (reviews.length > 0) {
      const total = reviews.reduce((sum, r) => sum + r.rating, 0);
      avgRating = total / reviews.length;
      avgRating = Number(avgRating.toFixed(1));
    }

    return res.json({
      isSuccess: true,
      message: "Service found successfully",
      data: {
        service,
        reviews,
        totalReviews: reviews.length,
        averageRating: avgRating,
        distance_km, // ✅ distance included
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

