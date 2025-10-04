// controllers/updateUserTags.js
const User = require("../model/User");
const Category = require("../model/Category");
const notificationController = require("./notificationController");
/** helper: normalize tags input (array / JSON string / comma string) */
function normalizeTags(raw) {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw))
    return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") {
    const s = raw.trim();
    // try JSON array
    if (
      (s.startsWith("[") && s.endsWith("]")) ||
      (s.startsWith('"') && s.endsWith('"'))
    ) {
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p))
          return p.map((t) => String(t).trim()).filter(Boolean);
        if (typeof p === "string") return [p.trim()].filter(Boolean);
      } catch (e) {
        /* ignore */
      }
    }
    if (s.includes(","))
      return s
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    return [s].filter(Boolean);
  }
  return [String(raw)].map((t) => t.trim()).filter(Boolean);
}

async function updateUserTags(req, res) {
  try {
    // get userId from body (preferred) or params (fallback)
    const userIdBody =
      req.body && req.body.userId ? String(req.body.userId).trim() : null;
    const userIdParam =
      req.params && req.params.userId ? String(req.params.userId).trim() : null;
    const userId = userIdBody || userIdParam;

    // If you use auth middleware set req.user
    const userIdToken = req.user && req.user.id ? String(req.user.id) : null;

    // If you're using auth, enforce the token==userId check:
    if (userIdToken) {
      if (!userId)
        return res
          .status(400)
          .json({ error: "userId required in body or params" });
      if (userId !== userIdToken)
        return res.status(403).json({ error: "Forbidden" });
    } else {
      if (!userId)
        return res
          .status(400)
          .json({ error: "userId required in body or params" });
    }

    // accept body values
    let { type, tags: rawTags, action = "add" } = req.body;

    // Normalize simple strings
    type = typeof type === "string" ? type.trim().toLowerCase() : type;
    action = typeof action === "string" ? action.trim().toLowerCase() : action;

    const tags = normalizeTags(rawTags);

    // basic validation
    if (!type || !["offer", "interest"].includes(type)) {
      return res
        .status(400)
        .json({ error: 'type must be "offer" or "interest"' });
    }
    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ error: "tags must be a non-empty array" });
    }
    if (!["add", "remove"].includes(action)) {
      return res
        .status(400)
        .json({ error: 'action must be "add" or "remove"' });
    }

    // ✅ load all categories (for validation only)
    const categories = await Category.find({}).lean();
    const allCategoryTags = new Map();
    categories.forEach((cat) => {
      (cat.tags || []).forEach((t) => {
        const key = String(t).trim().toLowerCase();
        allCategoryTags.set(key, String(t).trim()); // canonical text
      });
    });

    // validate tags
    const acceptedTags = [];
    const rejectedTags = [];
    tags.forEach((t) => {
      const k = String(t).trim().toLowerCase();
      if (k && allCategoryTags.has(k)) {
        acceptedTags.push(allCategoryTags.get(k));
      } else {
        rejectedTags.push(t);
      }
    });

    if (acceptedTags.length === 0) {
      return res.status(400).json({
        error: "No valid tags found",
        acceptedTags: [],
        rejectedTags,
      });
    }

    // choose user field
    const field = type === "interest" ? "interests" : "offeredTags";

    // build update
    let update;
    if (action === "add") {
      update = { $addToSet: { [field]: { $each: acceptedTags } } };
    } else {
      update = { $pull: { [field]: { $in: acceptedTags } } };
    }

    // update user
    const user = await User.findByIdAndUpdate(userId, update, {
      new: true,
    }).select(field);
    if (!user) return res.status(404).json({ error: "User not found" });
    // 🔔 Trigger nearby users notification only for interest updates
    if (type === "interest" && action === "add" && user.interests.length) {
      notificationController
        .notifyOnUserInterestUpdate(user)
        .catch((err) =>
          console.error("Interest notification failed:", err.message)
        );
    }

    return res.status(200).json({
      success: true,
      field,
      acceptedTags,
      rejectedTags,
      updatedTags: user[field] || [],
    });
  } catch (err) {
    console.error("updateUserTags error", err);
    return res.status(500).json({ error: "server error" });
  }
}

module.exports = { updateUserTags };
