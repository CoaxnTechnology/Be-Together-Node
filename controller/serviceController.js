const Service = require("../model/Service");
const Category = require("../model/Category");
const User = require("../model/User");
const mongoose = require("mongoose");

// Helpers
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
  return typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
}
function isValidDateISO(d) {
  return (
    typeof d === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !isNaN(new Date(d).getTime())
  );
}
exports.createService = async (req, res) => {
  try {
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
      category: category._id,
      tags: validTags,
      max_participants,
      service_type,
      owner: user._id,
    };

    if (service_type === "one_time") {
      if (!isValidTime(start_time) || !isValidTime(end_time)) {
        return res.status(400).json({
          isSuccess: false,
          message: "Invalid start_time or end_time",
        });
      }
      if (!isValidDateISO(date)) {
        return res.status(400).json({
          isSuccess: false,
          message: "Valid date (YYYY-MM-DD) required for one_time",
        });
      }
      servicePayload.date = new Date(date + "T00:00:00.000Z");
      servicePayload.start_time = start_time;
      servicePayload.end_time = end_time;
    }

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
        if (
          !item.day ||
          !isValidDateISO(item.date) ||
          !isValidTime(item.start_time) ||
          !isValidTime(item.end_time)
        ) {
          throw new Error(
            "Each recurring schedule item must include day, date, start_time, end_time in HH:mm format"
          );
        }
        return {
          day: item.day,
          date: new Date(item.date + "T00:00:00.000Z"),
          start_time: item.start_time,
          end_time: item.end_time,
        };
      });
    }

    // Save service
    const createdService = new Service(servicePayload);
    await createdService.save();

    // Link service to user
    user.services.push(createdService._id);
    await user.save();

    return res.json({
      isSuccess: true,
      message: "Service created successfully",
      data: createdService,
    });
  } catch (err) {
    console.error("createService error:", err);
    res
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

// ---------------- CREATE SERVICE ----------------
exports.createService = async (req, res) => {
  try {
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
      category: category._id,
      tags: validTags,
      max_participants,
      service_type,
      owner: user._id,
    };

    if (service_type === "one_time") {
      if (!isValidTime(start_time) || !isValidTime(end_time)) {
        return res.status(400).json({
          isSuccess: false,
          message: "Invalid start_time or end_time",
        });
      }
      if (!isValidDateISO(date)) {
        return res.status(400).json({
          isSuccess: false,
          message: "Valid date (YYYY-MM-DD) required for one_time",
        });
      }
      servicePayload.date = new Date(date + "T00:00:00.000Z");
      servicePayload.start_time = start_time;
      servicePayload.end_time = end_time;
    }

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
        if (
          !item.day ||
          !isValidDateISO(item.date) ||
          !isValidTime(item.start_time) ||
          !isValidTime(item.end_time)
        ) {
          throw new Error(
            "Each recurring schedule item must include day, date, start_time, end_time in HH:mm format"
          );
        }
        return {
          day: item.day,
          date: new Date(item.date + "T00:00:00.000Z"),
          start_time: item.start_time,
          end_time: item.end_time,
        };
      });
    }

    // Save service
    const createdService = new Service(servicePayload);
    await createdService.save();

    // Link service to user
    user.services.push(createdService._id);
    await user.save();

    return res.json({
      isSuccess: true,
      message: "Service created successfully",
      data: createdService,
    });
  } catch (err) {
    console.error("createService error:", err);
    res
      .status(500)
      .json({ isSuccess: false, message: "Server error", error: err.message });
  }
};

// ---------------- GET SERVICES ----------------
exports.getServices = async (req, res) => {
  try {
    console.log("===== getServices called =====");
    const q = { ...req.query, ...req.body };
    console.log("Received query/body:", q);

    // ---------- QUERY PARAMS ----------
    const categoryId = q.categoryId || null;
    const tags = tryParse(q.tags) || (q.tags ? [q.tags] : []);
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
      if (!looksLikeObjectId(categoryId)) {
        console.log("Invalid categoryId:", categoryId);
        return res
          .status(400)
          .json({ isSuccess: false, message: "Invalid categoryId" });
      }
      and.push({ category: categoryId });
      console.log("Category filter applied:", categoryId);
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
    if (
      lat != null &&
      lon != null &&
      !Number.isNaN(lat) &&
      !Number.isNaN(lon)
    ) {
      const box = bboxForLatLon(lat, lon, radiusKm);
      console.log("Bounding box for location filter:", box);
      and.push({ latitude: { $gte: box.minLat, $lte: box.maxLat } });
      and.push({ longitude: { $gte: box.minLon, $lte: box.maxLon } });
    }

    const mongoQuery = and.length ? { $and: and } : {};
    console.log("Final MongoDB query:", mongoQuery);

    // ---------- TOTAL COUNT ----------
    const totalCount = await Service.countDocuments(mongoQuery);
    console.log("Total services count matching query:", totalCount);

    // ---------- FETCH SERVICES ----------
    let services = await Service.find(mongoQuery)
      .select("-__v")
      .skip(skip)
      .limit(limit)
      .lean();
    console.log(
      "Fetched services before distance calculation:",
      services.length
    );
    // ---------- NO SERVICES CHECK ----------
    if (!services.length) {
      console.log("No services found for this location/filter.");
      return res.json({
        isSuccess: true,
        message: "No services available at your location",
        data: { totalCount: 0, page, limit, services: [] },
      });
    }

    // ---------- DISTANCE CALCULATION ----------
    if (lat != null && lon != null) {
      const toRad = (v) => (v * Math.PI) / 180;
      services.forEach((s) => {
        if (s.latitude != null && s.longitude != null) {
          const lat1 = lat,
            lon1 = lon;
          const lat2 = Number(s.latitude),
            lon2 = Number(s.longitude);
          const R = 6371; // km
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

      // Sort by distance
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

// controllers/userController.js


exports.getInterestedUsers = async (req, res) => {
  try {
    const {
      latitude = 0,
      longitude = 0,
      radius_km = 3,
      categoryId,
      tags = [],
      page = 1,
      limit = 10,
    } = req.body;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Base query
    const query = {};

    // Location filter only if lat/lon are non-zero
    if (Number(latitude) !== 0 && Number(longitude) !== 0) {
      query["lastLocation.coords"] = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseFloat(radius_km) * 1000, // convert km -> meters
        },
      };
    }

    // Interest filter (match at least one service tag)
    if (tags.length > 0) {
      query.interests = { $in: tags };
    }

    // Optional: you can also filter by categoryId if needed
    if (categoryId) {
      query.interests = query.interests
        ? { $in: [...tags, categoryId] }
        : { $in: [categoryId] };
    }

    // Fetch users
    const users = await User.find(query)
      .select("name email profile_image interests lastLocation")
      .skip(skip)
      .limit(parseInt(limit));

    // Total count
    const total = await User.countDocuments(query);

    if (users.length === 0) {
      return res.json({
        success: true,
        total: 0,
        page: parseInt(page),
        limit: parseInt(limit),
        message: "No users found matching this service and location.",
        users: [],
      });
    }

    res.json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      users,
    });
  } catch (error) {
    console.error("Error fetching interested users:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
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
