// controllers/updateUserTags.js
const User = require("../model/User");
const Category = require("../model/Category");
const mongoose = require("mongoose");

/** helper: normalize tags input (array / JSON string / comma string) */
function normalizeTags(raw) {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(t => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") {
    const s = raw.trim();
    // try JSON array
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith('"') && s.endsWith('"'))) {
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p)) return p.map(t => String(t).trim()).filter(Boolean);
        if (typeof p === "string") return [p.trim()].filter(Boolean);
      } catch (e) { /* ignore */ }
    }
    if (s.includes(",")) return s.split(",").map(t => t.trim()).filter(Boolean);
    return [s].filter(Boolean);
  }
  return [String(raw)].map(t => t.trim()).filter(Boolean);
}

async function updateUserTags(req, res) {
  try {
    // get userId from body (preferred) or params (fallback)
    const userIdBody = (req.body && req.body.userId) ? String(req.body.userId).trim() : null;
    const userIdParam = req.params && req.params.userId ? String(req.params.userId).trim() : null;
    const userId = userIdBody || userIdParam;

    // If you use auth middleware set req.user (uncomment check if using auth)
    const userIdToken = req.user && req.user.id ? String(req.user.id) : null;

    // If you're using auth, enforce the token==userId check:
    if (userIdToken) {
      if (!userId) return res.status(400).json({ error: "userId required in body or params" });
      if (userId !== userIdToken) return res.status(403).json({ error: "Forbidden" });
    } else {
      // If no auth middleware, require userId to be provided in body or param.
      if (!userId) return res.status(400).json({ error: "userId required in body or params" });
      // Note: you may want to remove this branch if you rely only on token-based auth.
    }

    // accept body values (works with application/json)
    let { type, tags: rawTags, action = "add", categoryId } = req.body;

    // Normalize simple strings (form-data could send these as strings)
    type = typeof type === "string" ? type.trim().toLowerCase() : type;
    action = typeof action === "string" ? action.trim().toLowerCase() : action;
    if (categoryId !== undefined && categoryId !== null) {
      if (typeof categoryId === "string" && categoryId.trim() !== "") {
        const n = Number(categoryId);
        categoryId = Number.isNaN(n) ? categoryId : n;
      }
    }

    const tags = normalizeTags(rawTags);

    // basic validation
    if (!type || !["offer", "interest"].includes(type)) {
      return res.status(400).json({ error: 'type must be "offer" or "interest"' });
    }
    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ error: "tags must be a non-empty array" });
    }
    if (!["add", "remove"].includes(action)) {
      return res.status(400).json({ error: 'action must be "add" or "remove"' });
    }
    if (categoryId === undefined || categoryId === null) {
      return res.status(400).json({ error: "categoryId is required for tag verification" });
    }

    // load category
    const category = await Category.findOne({ categoryId: Number(categoryId) }).lean();
    if (!category) return res.status(404).json({ error: "Category not found" });

    // case-insensitive matching + return canonical-case tags from category
    const catMap = {};
    (category.tags || []).forEach(t => {
      catMap[String(t).trim().toLowerCase()] = String(t).trim();
    });

    const acceptedTags = [];
    const rejectedTags = [];

    tags.forEach(t => {
      const k = String(t).trim().toLowerCase();
      if (k && catMap[k]) acceptedTags.push(catMap[k]); // store canonical tag text
      else rejectedTags.push(t);
    });

    if (acceptedTags.length === 0) {
      return res.status(400).json({
        error: "No valid tags found in this category",
        acceptedTags: [],
        rejectedTags
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
    const user = await User.findByIdAndUpdate(userId, update, { new: true }).select(field);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Optionally update Category.users membership (best-effort)
    try {
      const catFilter = { categoryId: Number(categoryId) };
      if (action === "add") {
        await Category.updateOne(catFilter, { $addToSet: { users: mongoose.Types.ObjectId(userId) } });
      } else {
        await Category.updateOne(catFilter, { $pull: { users: mongoose.Types.ObjectId(userId) } });
      }
    } catch (catErr) {
      console.error("Category.users update failed", catErr);
    }

    return res.status(200).json({
      success: true,
      field,
      acceptedTags,
      rejectedTags,
      updatedTags: user[field] || []
    });
  } catch (err) {
    console.error("updateUserTags error", err);
    return res.status(500).json({ error: "server error" });
  }
}

module.exports = { updateUserTags };
