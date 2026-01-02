// controller/profileController.js
const User = require("../model/User");
const Category = require("../model/Category");
const { getFullImageUrl } = require("../utils/image");
const streamifier = require("streamifier");
const notificationController = require("./notificationController");
const path = require("path");
const fs = require("fs");
const BASE_URL = process.env.BASE_URL;
// ---------------- UPDATE Profile ----------------
exports.editProfile = async (req, res) => {
  try {
    // don't set defaults here; we need to detect if a field was provided
    let { email, name, bio, city, age } = req.body;

    // helper: try parse JSON string fields (common with multipart/form-data)
    const tryParse = (val) => {
      if (typeof val !== "string") return val;
      const t = val.trim();
      if (
        (t.startsWith("{") && t.endsWith("}")) ||
        (t.startsWith("[") && t.endsWith("]"))
      ) {
        try {
          return JSON.parse(t);
        } catch (e) {
          return val;
        }
      }
      return val;
    };

    const rawLanguages = tryParse(req.body.languages);
    const rawInterests = tryParse(req.body.interests);
    const rawOfferedTags = tryParse(req.body.offeredTags);

    // Identify user
    let user = null;
    if (email) {
      user = await User.findOne({ email });
    } else if (req.user && req.user.id) {
      user = await User.findById(req.user.id);
    }

    if (!user) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found", data: null });
    }

    // Basic fields
    if (typeof name === "string" && name.trim() === "") {
      return res.status(400).json({
        isSuccess: false,
        message: "Name cannot be empty",
        data: null,
      });
    }
    if (typeof name === "string" && name.trim() !== "") user.name = name.trim();
    if (typeof bio === "string") user.bio = bio.trim();
    if (typeof city === "string") user.city = city.trim();
    if (age !== undefined) {
      const ageNumber = Number(age);
      if (isNaN(ageNumber) || ageNumber < 0) {
        return res.status(400).json({
          isSuccess: false,
          message: "Age must be a valid non-negative number",
          data: null,
        });
      }
      user.age = ageNumber;
    }

    // keep track of old Cloudinary public_id (if any) to delete later
    if (req.file) {
      if (user.profile_image) {
        try {
          const oldPath = user.profile_image.replace(BASE_URL, "");
          const fullOldPath = path.join(process.cwd(), oldPath);

          if (fs.existsSync(fullOldPath)) {
            fs.unlinkSync(fullOldPath);
            console.log("🗑️ Old profile image deleted");
          }
        } catch (err) {
          console.error("Old image delete failed (non-fatal):", err);
        }
      }

      // ---------------- SAVE NEW IMAGE ----------------
      user.profile_image = `${BASE_URL}/uploads/profile_images/${req.file.filename}`;
    }

    // ---------- Other fields ----------
    // Languages
    if (rawLanguages !== undefined) {
      if (!Array.isArray(rawLanguages)) {
        return res
          .status(400)
          .json({ isSuccess: false, message: "languages must be an array" });
      }
      user.languages = rawLanguages;
    }

    // ---------- Interests -> store ONLY canonical tags from matched Categories that user selected ----------
    const oldInterests = user.interests ? [...user.interests] : [];
    if (rawInterests !== undefined) {
      if (!Array.isArray(rawInterests)) {
        return res
          .status(400)
          .json({ isSuccess: false, message: "interests must be an array" });
      }

      if (rawInterests.length === 0) {
        user.interests = [];
      } else {
        const inputClean = rawInterests
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter(Boolean);

        if (!inputClean.length) {
          user.interests = [];
        } else {
          const tagRegexes = inputClean.map(
            (t) => new RegExp(`^${escapeRegExp(t)}$`, "i")
          );

          const foundCategories = await Category.find({
            tags: { $in: tagRegexes },
          });

          if (!foundCategories.length) {
            return res.status(400).json({
              isSuccess: false,
              message: "No matching interests found",
              data: null,
            });
          }

          const canonicalMap = new Map();
          for (const c of foundCategories) {
            if (Array.isArray(c.tags)) {
              for (const tg of c.tags) {
                if (typeof tg === "string") {
                  const trimmed = tg.trim();
                  canonicalMap.set(trimmed.toLowerCase(), trimmed);
                }
              }
            }
          }

          const result = [];
          const seen = new Set();
          for (const inp of inputClean) {
            const key = inp.toLowerCase();
            const canonical = canonicalMap.get(key);
            if (!canonical) {
              continue;
            }
            if (!seen.has(key)) {
              seen.add(key);
              result.push(canonical);
            }
          }

          user.interests = result;
        }
      }
      console.log("Interests updated:", user.interests);
    }

    // ---------- OfferedTags -> store ONLY canonical tags from matched Categories that user selected ----------
    if (rawOfferedTags !== undefined) {
      if (!Array.isArray(rawOfferedTags)) {
        return res
          .status(400)
          .json({ isSuccess: false, message: "offeredTags must be an array" });
      }

      if (rawOfferedTags.length === 0) {
        user.offeredTags = [];
      } else {
        // Clean input
        const inputClean = rawOfferedTags
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter(Boolean);

        if (!inputClean.length) {
          user.offeredTags = [];
        } else {
          // Build regexes and query categories for matching tags
          const tagRegexes = inputClean.map(
            (t) => new RegExp(`^${escapeRegExp(t)}$`, "i")
          );

          const foundCategories = await Category.find({
            tags: { $in: tagRegexes },
          });

          if (!foundCategories.length) {
            // If no canonical tags found, return error to force canonical selection
            return res.status(400).json({
              isSuccess: false,
              message: "No matching offeredTags found",
              data: null,
            });
          }

          // Build canonical map from matched categories
          const canonicalMap = new Map();
          for (const c of foundCategories) {
            if (Array.isArray(c.tags)) {
              for (const tg of c.tags) {
                if (typeof tg === "string") {
                  const trimmed = tg.trim();
                  canonicalMap.set(trimmed.toLowerCase(), trimmed);
                }
              }
            }
          }

          const result = [];
          const seen = new Set();
          for (const inp of inputClean) {
            const key = inp.toLowerCase();
            const canonical = canonicalMap.get(key);
            if (!canonical) {
              // Skip unknown offeredTag values (you could alternatively push raw value)
              continue;
            }
            if (!seen.has(key)) {
              seen.add(key);
              result.push(canonical);
            }
          }

          user.offeredTags = result;
        }
      }
    }

    await user.save();
    console.log("User profile saved successfully");
    // ✅ Refresh user from DB to get latest saved interests
    const updatedUser = await User.findById(user._id).select(
      "name interests lastLocation fcmToken"
    );
    // Only trigger if interests were updated
    const interestsChanged =
      rawInterests !== undefined &&
      (oldInterests.length !== user.interests.length ||
        oldInterests.some((i) => !user.interests.includes(i)));

    if (interestsChanged) {
      console.log("Interests changed, sending notifications...");
      await notificationController
        .notifyOnUserInterestUpdate(updatedUser)
        .catch((err) =>
          console.error("Interest notification failed:", err.message)
        );
    } else {
      console.log("Interests not changed, skipping notifications");
    }

    return res.json({
      isSuccess: true,
      message: "Profile updated successfully",
      data: {
        id: user._id,
        uid: user.uid,
        name: user.name,
        email: user.email,
        profile_image: getFullImageUrl(user.profile_image),
        bio: user.bio,
        city: user.city,
        languages: user.languages || [],
        interests: user.interests || [],
        offeredTags: user.offeredTags || [],
      },
    });
  } catch (err) {
    console.error("editProfile error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, message: "Server error", error: err.message });
  }

  // helper inside function scope
  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
};

exports.getUserProfileByEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Email is required" });
    }

    // ✅ Find user and populate full service details
    const user = await User.findOne({ email }).populate({
      path: "services",
      model: "Service",
      select: "-__v -updated_at",
      populate: [
        { path: "category", model: "Category", select: "name" },
        {
          path: "reviews",
          model: "Review",
          populate: { path: "user", select: "name profile_image" },
        },
      ],
    });

    if (!user) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found" });
    }

    // ✅ Compute avg rating for each service
    const servicesWithRating = user.services.map((service) => {
      let avgRating = 0;
      if (service.reviews?.length) {
        const total = service.reviews.reduce((sum, r) => sum + r.rating, 0);
        avgRating = Number((total / service.reviews.length).toFixed(1));
      }
      return {
        ...service.toObject(),
        totalReviews: service.reviews?.length || 0,
        averageRating: avgRating,
      };
    });

    res.json({
      isSuccess: true,
      message: "Profile fetched successfully",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        profile_image: getFullImageUrl(user.profile_image),
        bio: user.bio || "",
        city: user.city || "",
        languages: user.languages || [],
        age: user.age || null,
        interests: user.interests || [],
        offeredTags: user.offeredTags || [],
        currency: user.currency || "EUR",
        servicesCount: servicesWithRating.length, // total services
        services: servicesWithRating, // full service details with avg rating
      },
    });
  } catch (err) {
    console.error("getUserProfileByEmail error:", err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};

exports.getProfileById = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "userId is required" });
    }

    // ✅ Find user by ID and populate services
    const user = await User.findById(userId).populate({
      path: "services",
      model: "Service",
      select: "-__v -updated_at",
      populate: [
        { path: "category", model: "Category", select: "name" },
        {
          path: "reviews",
          model: "Review",
          populate: { path: "user", select: "name profile_image" },
        },
      ],
    });

    if (!user) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found" });
    }
    const servicesWithRating = user.services.map((service) => {
      let avgRating = 0;
      if (service.reviews?.length) {
        const total = service.reviews.reduce((sum, r) => sum + r.rating, 0);
        avgRating = Number((total / service.reviews.length).toFixed(1));
      }
      return {
        ...service.toObject(),
        totalReviews: service.reviews?.length || 0,
        averageRating: avgRating,
      };
    });
    res.json({
      isSuccess: true,
      message: "Profile fetched successfully",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        profile_image: getFullImageUrl(user.profile_image),
        bio: user.bio || "",
        city: user.city || "",
        languages: user.languages || [],
        interests: user.interests || [],
        offeredTags: user.offeredTags || [],
        age: user.age || null,
        servicesCount: user.services.length,
        services: user.services || [],
        servicesCount: servicesWithRating.length, // total services
        services: servicesWithRating, // full service details with avg rating
      },
    });
  } catch (err) {
    console.error("getUserProfileById error:", err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};
//
