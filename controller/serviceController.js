const Service = require("../model/Service");
const Category = require("../model/Category");
const User = require("../model/User");

// Helpers
function tryParse(val) {
  if (val === undefined || val === null) return val;
  if (typeof val !== "string") return val;
  try { return JSON.parse(val); } catch (e) { return val; }
}

// Simple date/time validators
function isValidTime(t) {
  return typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
}
function isValidDateISO(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());
}

exports.createService = async (req, res) => {
  try {
    const userId = req.body.userId || (req.user && req.user.id);
    if (!userId) return res.status(400).json({ isSuccess: false, message: "userId is required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ isSuccess: false, message: "User not found" });
    if (!user.is_active) return res.status(403).json({ isSuccess: false, message: "User is not active" });

    const body = req.body;
    const title = body.title && String(body.title).trim();
    const description = body.description || "";
    const language = body.Language || body.language || "English"; // fallback
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
    if (!title) return res.status(400).json({ isSuccess: false, message: "Title is required" });
    if (!location || !location.name || location.latitude == null || location.longitude == null) {
      return res.status(400).json({ isSuccess: false, message: "Location (name, latitude, longitude) is required" });
    }
    if (!categoryId) return res.status(400).json({ isSuccess: false, message: "categoryId is required" });

    const category = await Category.findById(categoryId);
    if (!category) return res.status(404).json({ isSuccess: false, message: "Category not found" });

    if (!Array.isArray(selectedTags) || !selectedTags.length) {
      return res.status(400).json({ isSuccess: false, message: "selectedTags must be a non-empty array" });
    }

    const validTags = category.tags.filter((tag) =>
      selectedTags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    );
    if (!validTags.length) return res.status(400).json({ isSuccess: false, message: "No valid tags selected from this category" });

    // Build payload
    const servicePayload = {
      title,
      description,
      Language: language,             // matches schema
      isFree,
      price,
      location_name: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      category: category._id,
      tags: validTags,
      max_participants,
      service_type,
      owner: user._id,                // matches schema
    };

    if (service_type === "one_time") {
      if (!isValidTime(start_time) || !isValidTime(end_time))
        return res.status(400).json({ isSuccess: false, message: "Invalid start_time or end_time" });
      if (!isValidDateISO(date))
        return res.status(400).json({ isSuccess: false, message: "Valid date (YYYY-MM-DD) required for one_time" });

      servicePayload.date = new Date(date + "T00:00:00.000Z");
      servicePayload.start_time = start_time;
      servicePayload.end_time = end_time;
    }

    // Save service
    const createdService = new Service(servicePayload);
    await createdService.save();

    // Link service to user
    user.services.push(createdService._id);
    await user.save();

    return res.json({ isSuccess: true, message: "Service created successfully", data: createdService });

  } catch (err) {
    console.error("createService error:", err);
    res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};


// ----------- Get Services -------------
exports.getServices = async (req, res) => {
  try {
    const q = Object.assign({}, req.query || {}, req.body || {});
    const categoryId = q.categoryId || null;
    const tags = tryParse(q.tags) || (q.tags ? [q.tags] : []);
    const isFree = q.isFree === undefined ? null : (q.isFree === "true" || q.isFree === true);
    const dateStr = q.date || null;
    const lat = q.latitude !== undefined ? Number(q.latitude) : null;
    const lon = q.longitude !== undefined ? Number(q.longitude) : null;
    const radiusKm = q.radius_km !== undefined ? Number(q.radius_km) : 5;

    const page = Math.max(1, Number(q.page || 1));
    const limit = Math.min(100, Number(q.limit || 20));
    const skip = (page - 1) * limit;
    const sortBy = q.sortBy || "created_at";
    const sortDir = q.sortDir === "asc" ? 1 : -1;

    const and = [];
    if (categoryId) {
      if (!looksLikeObjectId(categoryId)) return res.status(400).json({ isSuccess: false, message: "Invalid categoryId" });
      and.push({ category: categoryId });
    }

    if (tags && Array.isArray(tags) && tags.length) {
      const normalized = tags.map(t => String(t).trim()).filter(Boolean);
      if (normalized.length) and.push({ tags: { $in: normalized } });
    }

    if (isFree !== null) and.push({ isFree: !!isFree });

    if (dateStr) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
        return res.status(400).json({ isSuccess: false, message: "Invalid date format, expected YYYY-MM-DD" });
      const dateRange = dateRangeForDay(dateStr);
      and.push({
        $or: [
          { $and: [{ service_type: "one_time" }, { date: { $gte: dateRange.start, $lt: dateRange.end } }] },
          { $and: [{ service_type: "recurring" }, { "recurring_schedule.date": { $exists: true, $gte: dateRange.start, $lt: dateRange.end } }] }
        ]
      });
    }

    if (lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
      const box = bboxForLatLon(lat, lon, isNaN(radiusKm) ? 5 : radiusKm);
      and.push({ "location.latitude": { $gte: box.minLat, $lte: box.maxLat } });
      and.push({ "location.longitude": { $gte: box.minLon, $lte: box.maxLon } });
    }

    const mongoQuery = and.length ? { $and: and } : {};
    const totalCount = await Service.countDocuments(mongoQuery);

    let sortObj = {};
    if (sortBy === "price") sortObj.price = sortDir;
    else sortObj.created_at = sortDir;

    const services = await Service.find(mongoQuery).select("-__v").sort(sortObj).skip(skip).limit(limit).lean();

    return res.json({ isSuccess: true, message: "Services fetched", data: { totalCount, page, limit, services } });
  } catch (err) {
    console.error("getServices error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};
