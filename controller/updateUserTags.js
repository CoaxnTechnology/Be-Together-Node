// controllers/userTags.js
const User = require("../model/User");
const Category = require("../model/Category");
const mongoose = require("mongoose");

/**
 * Single API to update user's interests or offered services.
 */
async function updateUserTags(req, res) {
  try {
    const userIdPath = req.params.userId;
    const userIdToken = req.user && req.user.id; // auth middleware must set req.user
    if (!userIdToken) return res.status(401).json({ error: "Unauthorized" });
    if (userIdPath !== userIdToken)
      return res.status(403).json({ error: "Forbidden" });

    const { type, tags, action = "add", categoryId } = req.body;

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
    if (!categoryId) {
      return res
        .status(400)
        .json({ error: "categoryId is required for tag verification" });
    }

    // load category
    const category = await Category.findOne({
      categoryId: Number(categoryId),
    }).lean();
    if (!category) return res.status(404).json({ error: "Category not found" });

    // normalize for case-insensitive matching
    const categoryTagSet = new Set(
      (category.tags || []).map((t) => String(t).trim().toLowerCase())
    );
    const incoming = tags.map((t) => String(t).trim()).filter(Boolean);

    const acceptedTags = [];
    const rejectedTags = [];

    incoming.forEach((t) => {
      if (categoryTagSet.has(t.toLowerCase())) acceptedTags.push(t);
      else rejectedTags.push(t);
    });

    if (acceptedTags.length === 0) {
      return res.status(400).json({
        error: "No valid tags found in this category",
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
      // remove
      update = { $pull: { [field]: { $in: acceptedTags } } };
    }

    // update user
    const user = await User.findByIdAndUpdate(userIdPath, update, {
      new: true,
    }).select(field);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Optionally update Category.users membership (best-effort)
    try {
      const catFilter = { categoryId: Number(categoryId) };
      if (action === "add") {
        await Category.updateOne(catFilter, {
          $addToSet: { users: mongoose.Types.ObjectId(userIdPath) },
        });
      } else {
        // remove
        await Category.updateOne(catFilter, {
          $pull: { users: mongoose.Types.ObjectId(userIdPath) },
        });
      }
    } catch (catErr) {
      console.error("Category.users update failed", catErr);
      // do not fail the main flow
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
