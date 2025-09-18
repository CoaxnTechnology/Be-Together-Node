// controllers/serviceController.js
const Service = require("../model/Service");
const User = require("../model/User");
const Category = require("../model/Category");

// helper to parse JSON (for form-data inputs)
function tryParse(val) {
  if (typeof val !== "string") return val;
  const t = val.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch (e) { return val; }
  }
  return val;
}

function isValidTime(str) {
  return typeof str === "string" && /^\d{2}:\d{2}$/.test(str) && (() => {
    const [h, m] = str.split(":").map(Number);
    return h >= 0 && h < 24 && m >= 0 && m < 60;
  })();
}

function isValidDateISO(str) {
  if (typeof str !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str);
  return !Number.isNaN(d.getTime());
}

exports.createService = async (req, res) => {
  try {
    // ✅ Take userId directly (from req.body or req.user.id if authenticated)
    const userId = req.body.userId || (req.user && req.user.id);

    if (!userId) {
      return res.status(400).json({ isSuccess: false, message: "userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ isSuccess: false, message: "User not found" });
    }
    if (!user.is_active) {
      return res.status(403).json({ isSuccess: false, message: "User is not active" });
    }

    // Extract body data
    const body = req.body;
    const title = body.title && String(body.title).trim();
    const description = body.description || "";
    const language = body.language || "English";
    const isFree = body.isFree === true || body.isFree === "true";
    const price = isFree ? 0 : Number(body.price || 0);

    const location = tryParse(body.location); // must be object {name, latitude, longitude}
    const service_type = body.service_type || "one_time";
    const date = body.date;
    const start_time = body.start_time;
    const end_time = body.end_time;
    const recurring_days = tryParse(body.recurring_days) || [];
    const max_participants = Number(body.max_participants || 1);

    // category + tags from frontend
    const categoryId = body.categoryId;
    const selectedTags = tryParse(body.selectedTags) || [];

    // Validate
    if (!title) return res.status(400).json({ isSuccess: false, message: "Title is required" });
    if (!location || !location.name || location.latitude == null || location.longitude == null) {
      return res.status(400).json({ isSuccess: false, message: "Location (name, latitude, longitude) is required" });
    }
    if (!isValidTime(start_time) || !isValidTime(end_time)) {
      return res.status(400).json({ isSuccess: false, message: "Invalid start_time or end_time" });
    }
    if (service_type === "one_time" && !isValidDateISO(date)) {
      return res.status(400).json({ isSuccess: false, message: "Valid date (YYYY-MM-DD) required for one_time" });
    }
    if (service_type === "recurring" && (!Array.isArray(recurring_days) || !recurring_days.length)) {
      return res.status(400).json({ isSuccess: false, message: "recurring_days required for recurring services" });
    }
    if (!categoryId) {
      return res.status(400).json({ isSuccess: false, message: "categoryId is required" });
    }

    // ✅ Fetch category and validate tags
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ isSuccess: false, message: "Category not found" });
    }

    if (!Array.isArray(selectedTags) || !selectedTags.length) {
      return res.status(400).json({ isSuccess: false, message: "selectedTags must be a non-empty array" });
    }

    // filter tags that actually exist in category.tags
    const validTags = category.tags.filter(tag =>
      selectedTags.map(t => t.toLowerCase()).includes(tag.toLowerCase())
    );

    if (!validTags.length) {
      return res.status(400).json({ isSuccess: false, message: "No valid tags selected from this category" });
    }

    // ✅ Print to console
    console.log("📌 Category:", category.name);
    console.log("📌 Selected Tags:", validTags);

    // Build service object
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
      category: {
        id: category._id,
        name: category.name,
        image: category.image || null,
      },
      tags: validTags,
      max_participants,
      service_type,
      start_time,
      end_time,
      created_by: user._id,
    };

    if (service_type === "one_time") {
      servicePayload.date = new Date(date + "T00:00:00.000Z");
    } else {
      servicePayload.recurring_days = recurring_days.map(
        d => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()
      );
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
      data: {
        id: createdService._id,
        title: createdService.title,
        description: createdService.description,
        location: createdService.location,
        service_type: createdService.service_type,
        date: createdService.date,
        start_time: createdService.start_time,
        end_time: createdService.end_time,
        recurring_days: createdService.recurring_days,
        max_participants: createdService.max_participants,
        isFree: createdService.isFree,
        price: createdService.price,
        tags: createdService.tags,
        category: createdService.category, // ✅ included in response
        created_by: createdService.created_by,
        created_at: createdService.created_at,
      },
    });
  } catch (err) {
    console.error("createService error:", err);
    res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};
