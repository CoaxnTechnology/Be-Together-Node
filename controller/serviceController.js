const Service = require("../model/Service");
const Category = require("../model/Category");
const User = require("../model/User");
exports.createService = async (req, res) => {
  try {
    const userId = req.body.userId || (req.user && req.user.id);
    if (!userId) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "userId is required" });
    }

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
    const language = body.language || "English";
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

    // Validation
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
      return res
        .status(400)
        .json({
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
      return res
        .status(400)
        .json({
          isSuccess: false,
          message: "selectedTags must be a non-empty array",
        });
    }

    const validTags = category.tags.filter((tag) =>
      selectedTags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    );
    if (!validTags.length) {
      return res
        .status(400)
        .json({
          isSuccess: false,
          message: "No valid tags selected from this category",
        });
    }

    console.log("📌 Category:", category.name);
    console.log("📌 Selected Tags:", validTags);

    // Build payload
    const servicePayload = {
      title,
      description,
      language,
      isFree,
      price,
      location: {
        name: location.name,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
      },
      category: category._id,
      tags: validTags,
      max_participants,
      service_type,
      created_by: user._id,
    };

    if (service_type === "one_time") {
      // validate time
      if (!isValidTime(start_time) || !isValidTime(end_time)) {
        return res
          .status(400)
          .json({
            isSuccess: false,
            message: "Invalid start_time or end_time",
          });
      }
      if (!isValidDateISO(date)) {
        return res
          .status(400)
          .json({
            isSuccess: false,
            message: "Valid date (YYYY-MM-DD) required for one_time",
          });
      }

      servicePayload.date = new Date(date + "T00:00:00.000Z");
      servicePayload.start_time = start_time;
      servicePayload.end_time = end_time;
    } else if (service_type === "recurring") {
      const recurring_schedule = tryParse(body.recurring_schedule) || [];
      if (!Array.isArray(recurring_schedule) || !recurring_schedule.length) {
        return res.status(400).json({
          isSuccess: false,
          message:
            "recurring_schedule must be array of {day,start_time,end_time}",
        });
      }

      // optional: require start_date to calculate actual dates
      const startDateStr = body.start_date;
      if (!startDateStr || !isValidDateISO(startDateStr)) {
        return res
          .status(400)
          .json({
            isSuccess: false,
            message: "start_date (YYYY-MM-DD) is required for recurring",
          });
      }
      const startDate = new Date(startDateStr + "T00:00:00.000Z");

      const WEEKDAY_MAP = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      };

      function nextDateForWeekday(base, weekday) {
        const d = new Date(base);
        const diff = (weekday + 7 - d.getDay()) % 7;
        d.setDate(d.getDate() + diff);
        return d;
      }

      servicePayload.recurring_schedule = [];

      for (const slot of recurring_schedule) {
        const day = slot.day;
        const sTime = slot.start_time;
        const eTime = slot.end_time;

        if (!day || !WEEKDAY_MAP[day.toLowerCase()]) {
          return res
            .status(400)
            .json({ isSuccess: false, message: `Invalid day: ${day}` });
        }
        if (!isValidTime(sTime) || !isValidTime(eTime)) {
          return res
            .status(400)
            .json({ isSuccess: false, message: `Invalid time for ${day}` });
        }

        const weekdayNum = WEEKDAY_MAP[day.toLowerCase()];
        const firstDate = nextDateForWeekday(startDate, weekdayNum);

        servicePayload.recurring_schedule.push({
          day,
          start_time: sTime,
          end_time: eTime,
          date: firstDate,
        });
      }
    }

    // Save
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
//-----------------------get service with diffrent parameter------------


function tryParse(val) {
  if (val === undefined || val === null) return val;
  if (typeof val !== "string") return val;
  try { return JSON.parse(val); } catch (e) { return val; }
}
function bboxForLatLon(lat, lon, radiusKm = 5) {
  const R = 6371; // earth radius km
  const degLat = (radiusKm / R) * (180 / Math.PI);
  const degLon = (radiusKm / R) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);
  return {
    minLat: lat - degLat,
    maxLat: lat + degLat,
    minLon: lon - degLon,
    maxLon: lon + degLon,
  };
}
function looksLikeObjectId(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
}

// New: listServices
exports.getServices = async (req, res) => {
  try {
    // Accept either query params (GET) or body (POST/form-data)
    const q = Object.assign({}, req.query || {}, req.body || {});

    // Filters
    const categoryId = q.categoryId || null;            // single category ObjectId
    const tags = tryParse(q.tags) || (q.tags ? [q.tags] : []); // tags can be JSON string or single value
    const isFree = q.isFree === undefined ? null : (q.isFree === "true" || q.isFree === true);
    const dateStr = q.date || null;                     // "YYYY-MM-DD"
    const lat = q.latitude !== undefined ? Number(q.latitude) : null;
    const lon = q.longitude !== undefined ? Number(q.longitude) : null;
    const radiusKm = q.radius_km !== undefined ? Number(q.radius_km) : 5;

    // Pagination & sorting
    const page = Math.max(1, Number(q.page || 1));
    const limit = Math.min(100, Number(q.limit || 20));
    const skip = (page - 1) * limit;
    const sortBy = q.sortBy || "created_at"; // created_at, price, distance (distance handled separately)
    const sortDir = q.sortDir === "asc" ? 1 : -1;

    // Build Mongo query
    const and = [];

    // category filter
    if (categoryId) {
      if (!looksLikeObjectId(categoryId)) {
        return res.status(400).json({ isSuccess: false, message: "Invalid categoryId" });
      }
      and.push({ category: categoryId });
    }

    // tags filter (match any tag) — supports array or single string
    if (tags && Array.isArray(tags) && tags.length) {
      // match services that have at least one of these tags
      const normalized = tags.map(t => String(t).trim()).filter(Boolean);
      if (normalized.length) and.push({ tags: { $in: normalized } });
    }

    // isFree filter
    if (isFree !== null) {
      and.push({ isFree: !!isFree });
    }

    // date filter: include one_time services that fall on that date,
    // and recurring services whose recurring_schedule.date equals that date (if stored)
    // We'll treat dateStr as YYYY-MM-DD
    let dateRange = null;
    if (dateStr) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ isSuccess: false, message: "Invalid date format, expected YYYY-MM-DD" });
      }
      dateRange = dateRangeForDay(dateStr);

      // Build an $or: one_time match OR recurring_schedule.date match OR recurring_schedule.day match
      // We'll match recurring_schedule.date if it exists (computed at creation)
      and.push({
        $or: [
          // one_time within that UTC day
          {
            $and: [
              { service_type: "one_time" },
              { date: { $gte: dateRange.start, $lt: dateRange.end } },
            ],
          },
          // recurring: if recurring_schedule array contains date in the day
          {
            $and: [
              { service_type: "recurring" },
              { "recurring_schedule.date": { $exists: true, $gte: dateRange.start, $lt: dateRange.end } },
            ],
          },
        ],
      });
    }

    // Location filter: compute bounding box and add lat/lon range filters
    if (lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
      const box = bboxForLatLon(lat, lon, isNaN(radiusKm) ? 5 : radiusKm);
      and.push({
        "location.latitude": { $gte: box.minLat, $lte: box.maxLat },
      });
      and.push({
        "location.longitude": { $gte: box.minLon, $lte: box.maxLon },
      });
    }

    // Build final query
    const mongoQuery = and.length ? { $and: and } : {};

    // Count total (for pagination)
    const totalCount = await Service.countDocuments(mongoQuery);

    // Basic sort: if sorting by distance and lat/lon provided, we'll compute distance client-side approx
    let sortObj = {};
    if (sortBy === "price") sortObj.price = sortDir;
    else if (sortBy === "created_at") sortObj.created_at = sortDir;
    else sortObj.created_at = sortDir;

    // Fetch
    const services = await Service.find(mongoQuery)
      .select("-__v")
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();

    // If lat/lon provided, compute approximate distance (Haversine) in km and attach to each result.
    if (lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
      const toRad = v => (v * Math.PI) / 180;
      for (const s of services) {
        if (s.location && s.location.latitude != null && s.location.longitude != null) {
          const lat1 = Number(lat);
          const lon1 = Number(lon);
          const lat2 = Number(s.location.latitude);
          const lon2 = Number(s.location.longitude);
          const R = 6371; // km
          const dLat = toRad(lat2 - lat1);
          const dLon = toRad(lon2 - lon1);
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const dist = R * c;
          s.distance_km = Math.round(dist * 100) / 100;
        } else {
          s.distance_km = null;
        }
      }
      // If sortBy === "distance", sort in JS
      if (q.sortBy === "distance") {
        services.sort((a, b) => (a.distance_km || 999999) - (b.distance_km || 999999));
      }
    }

    // Response
    return res.json({
      isSuccess: true,
      message: "Services fetched",
      data: {
        totalCount,
        page,
        limit,
        services,
      },
    });
  } catch (err) {
    console.error("listServices error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};