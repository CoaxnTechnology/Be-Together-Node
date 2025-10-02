const moment = require("moment");
const User = require("../model/User");
const Category = require("../model/Category");
const Service = require("../model/Service");
const mongoose = require("mongoose");
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
    const city = body.city;
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

    // Build payload
    const servicePayload = {
      title,
      description,
      Language: language,
      isFree,
      price,
      location_name: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      city,
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

      servicePayload.date = date; // store as string "YYYY-MM-DD"
      servicePayload.start_time = formattedStart;
      servicePayload.end_time = formattedEnd;
    }

    // Recurring service
    if (service_type === "recurring") {
      const recurring_schedule = tryParse(body.recurring_schedule) || [];
      if (
        !Array.isArray(recurring_schedule) ||
        recurring_schedule.length === 0
      ) {
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
          date: item.date, // store as string "YYYY-MM-DD"
          start_time: formattedStart,
          end_time: formattedEnd,
        };
      });
    }

    // Save service
    const createdService = new Service(servicePayload);
    await createdService.save();

    // Link service to user
    user.services.push(createdService._id);
    await user.save();

    console.log("Service created successfully:", createdService._id);
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
exports.getServices = async (req, res) => {
  try {
    console.log("===== getServices called =====");
    const q = { ...req.query, ...req.body };
    console.log("Received query/body:", q);

    // ---------- QUERY PARAMS ----------
    let categoryId = q.categoryId || null;
    if (categoryId && typeof categoryId === "string") {
      try {
        categoryId = JSON.parse(categoryId);
      } catch {
        // keep as string
      }
    }

    const tags = Array.isArray(q.tags) ? q.tags : q.tags ? [q.tags] : [];
    const lat = q.latitude !== undefined ? Number(q.latitude) : null;
    const lon = q.longitude !== undefined ? Number(q.longitude) : null;
    const radiusKm = q.radius_km !== undefined ? Number(q.radius_km) : 3;

    const page = Math.max(1, Number(q.page || 1));
    const limit = Math.min(100, Number(q.limit || 20));
    const skip = (page - 1) * limit;

    console.log({ page, limit, skip, categoryId, tags, lat, lon, radiusKm });

    const and = [];

    // ---------- CATEGORY FILTER ----------
    if (categoryId) {
      if (Array.isArray(categoryId)) {
        const validIds = categoryId.filter((id) => looksLikeObjectId(id));
        if (validIds.length) {
          and.push({ category: { $in: validIds } });
          console.log("Multiple categories filter applied:", validIds);
        }
      } else {
        if (!looksLikeObjectId(categoryId)) {
          console.log("Invalid categoryId:", categoryId);
          return res
            .status(400)
            .json({ isSuccess: false, message: "Invalid categoryId" });
        }
        and.push({ category: categoryId });
        console.log("Single category filter applied:", categoryId);
      }
    }

    // ---------- TAGS FILTER ----------
    if (tags.length) {
      const normalizedTags = tags.map((t) => String(t).trim()).filter(Boolean);
      if (normalizedTags.length) {
        and.push({ tags: { $in: normalizedTags } });
        console.log("Tags filter applied:", normalizedTags);
      }
    }

    // ---------- LOCATION FILTER ----------
    if (lat != null && lon != null && !(lat === 0 && lon === 0)) {
      const box = bboxForLatLon(lat, lon, radiusKm);
      console.log("Bounding box for location filter:", box);
      and.push({ latitude: { $gte: box.minLat, $lte: box.maxLat } });
      and.push({ longitude: { $gte: box.minLon, $lte: box.maxLon } });
    } else if (lat === 0 && lon === 0) {
      console.log("Lat/Lon are zero → skipping location filter.");
    }
     // ---------- EXCLUDE OWN SERVICES ----------
    let excludeOwnerId = null;

    // Case 1: Agar auth middleware laga ho
    if (req.user && req.user._id) {
      excludeOwnerId = req.user._id.toString();
    }

    // Case 2: Agar frontend ne explicitly bheja
    if (q.excludeOwnerId) {
      excludeOwnerId = q.excludeOwnerId;
    }

    if (excludeOwnerId && looksLikeObjectId(excludeOwnerId)) {
      and.push({ owner: { $ne: excludeOwnerId } });
      console.log("Excluding services owned by:", excludeOwnerId);
    }


    const mongoQuery = and.length ? { $and: and } : {};
    console.log("Final MongoDB query for services:", mongoQuery);

    // ---------- TOTAL COUNT ----------
    const totalCount = await Service.countDocuments(mongoQuery);
    console.log("Total services count matching query:", totalCount);

    // ---------- FETCH SERVICES ----------
    let services = await Service.find(mongoQuery)
      .select("-__v")
      .populate({ path: "category", select: "name" })
      .populate({ path: "owner", select: "name email profile_image" })
      .skip(skip)
      .limit(limit)
      .lean();
    console.log(
      "Fetched services before distance calculation:",
      services.length
    );

    // ---------- DISTANCE CALCULATION ----------
    if (lat != null && lon != null && !(lat === 0 && lon === 0)) {
      const toRad = (v) => (v * Math.PI) / 180;
      services.forEach((s) => {
        if (s.latitude != null && s.longitude != null) {
          const lat1 = lat,
            lon1 = lon;
          const lat2 = Number(s.latitude),
            lon2 = Number(s.longitude);
          const R = 6371;
          const dLat = toRad(lat2 - lat1);
          const dLon = toRad(lon2 - lon1);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
              Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          s.distance_km = Math.round(R * c * 100) / 100;
        } else s.distance_km = null;
      });

      services.sort(
        (a, b) => (a.distance_km || 9999) - (b.distance_km || 9999)
      );
      console.log("Services sorted by distance.");
    }

    console.log("Final services to return:", services.length);

    return res.json({
      isSuccess: true,
      message: "Services fetched successfully",
      data: { totalCount, page, limit, services },
    });
  } catch (err) {
    console.error("getServices error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, message: "Server error", error: err.message });
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

    if (categoryId) {
      const services = await Service.find({ category: categoryId })
        .select("tags")
        .lean();
      console.log(
        `Fetched ${services.length} services for category ${categoryId}`
      );

      services.forEach((s) => {
        if (Array.isArray(s.tags)) interestsFilter.push(...s.tags);
      });
    }

    if (tags && tags.length) {
      interestsFilter.push(...tags);
      console.log("Additional tags from request:", tags);
    }

    // Remove duplicates & normalize
    interestsFilter = [
      ...new Set(interestsFilter.map((t) => t.trim().toLowerCase())),
    ];
    console.log("Final interests filter:", interestsFilter);

    // ---------- Step 2: Build user query ----------
    const query = {};

    if (excludeSelf && userId) {
      query._id = { $ne: userId };
      console.log("Excluding self userId:", userId);
    }

    if (interestsFilter.length) {
      query.interests = { $in: interestsFilter };
      console.log("Applying interests filter");
    } else {
      console.log("No interests filter → will fetch all users within location");
    }

    // ---------- Step 3: Location filter ----------
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
    } else {
      console.log("Skipping location filter (lat/lon = 0)");
    }

    console.log("MongoDB user query:", JSON.stringify(query, null, 2));

    // ---------- Step 4: Fetch users ----------
    let users = await User.find(query)
      .select("name email profile_image interests lastLocation")
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    console.log(`Fetched ${users.length} users before distance calculation`);

    // ---------- Step 5: Distance calculation ----------
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
      console.log("Users sorted by distance");
    }

    // ---------- Step 6: Total count ----------
    const total = await User.countDocuments(query);
    console.log(`Total matching users: ${total}`);

    // ---------- Step 7: Return response ----------
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
