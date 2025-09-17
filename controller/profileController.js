// controllers/userController.js
const mongoose = require("mongoose");
const User = require("../model/User"); // adjust path as needed
const Category = require("../model/Category"); // adjust path as needed

// Cloudinary helper functions - implement these in your utils or service files
// Example signatures are provided; replace with your actual implementations.
const {
  extractPublicIdFromCloudinaryUrl,
  uploadBufferToCloudinary,
  deleteCloudinaryImage,
  getFullImageUrl,
} = require("../utils/cloudinaryHelpers"); // adjust path as needed

/**
 * editProfile controller
 * - Finds user by email (preferred) or by req.user.id if email not provided
 * - Validates & updates basic fields
 * - Handles profile image upload / client-provided URL / deletion of old Cloudinary image
 * - Validates interests against Category.tags and only allows tags that already exist in DB
 * - Replaces languages / availability if non-empty arrays provided
 */
exports.editProfile = async (req, res) => {
  try {
    const {
      email,
      name,
      bio,
      city,
      languages = [],
      interests = [],
      availability = [],
      profile_image: clientImageUrl, // optional url from client (Flutter)
    } = req.body;

    // Identify user by email first (as requested), else by authenticated user id
    let user = null;
    if (email) {
      user = await User.findOne({ email: email.trim().toLowerCase() });
    } else if (req.user && req.user.id) {
      user = await User.findById(req.user.id);
    }

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
        data: null,
      });
    }

    // --- Update basic fields ---
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

    // Profile image handling (priority):
    // 1) if req.file present -> upload to Cloudinary (server-side)
    // 2) else if client provided profile_image URL in body -> use that
    // 3) else leave existing unchanged
    let newImageObjOrUrl = null;
    let newPublicId = null;
    let oldPublicId = null;

    // capture old public id if present (for deletion later)
    if (user.profile_image) {
      if (typeof user.profile_image === "string") {
        oldPublicId = extractPublicIdFromCloudinaryUrl(user.profile_image);
      } else if (user.profile_image && user.profile_image.public_id) {
        oldPublicId = user.profile_image.public_id;
      }
    }

    if (req.file && req.file.buffer) {
      // Upload new image to Cloudinary
      try {
        const publicId = `user_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const result = await uploadBufferToCloudinary(
          req.file.buffer,
          "profile_images",
          publicId
        );
        newImageObjOrUrl = {
          public_id: result.public_id,
          secure_url: result.secure_url,
        };
        newPublicId = result.public_id;
      } catch (uploadErr) {
        console.error("Cloudinary upload failed in editProfile:", uploadErr);
        return res
          .status(500)
          .json({ isSuccess: false, message: "Image upload failed" });
      }
    } else if (
      clientImageUrl &&
      typeof clientImageUrl === "string" &&
      clientImageUrl.trim() !== ""
    ) {
      const url = clientImageUrl.trim();
      const extracted = extractPublicIdFromCloudinaryUrl(url);
      if (extracted) {
        newImageObjOrUrl = { public_id: extracted, secure_url: url };
        newPublicId = extracted;
      } else {
        // store raw URL if not Cloudinary or can't extract
        newImageObjOrUrl = url;
      }
    }

    // Assign new image if present
    if (newImageObjOrUrl) {
      user.profile_image = newImageObjOrUrl;
    }

    // --- Languages ---
    if (Array.isArray(languages) && languages.length > 0) {
      // sanitize: keep only non-empty strings
      user.languages = languages
        .map((l) => (typeof l === "string" ? l.trim() : ""))
        .filter((l) => l.length > 0);
    }

    // --- Interests (IMPORTANT) ---
    // Requirement: only allow interests that exist in Category.tags. No extra tags allowed.
    if (Array.isArray(interests) && interests.length > 0) {
      // normalize incoming tags to strings and trim
      const incomingTags = interests
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t.length > 0);

      if (incomingTags.length === 0) {
        return res.status(400).json({
          isSuccess: false,
          message: "Interests array is empty or invalid",
          data: null,
        });
      }

      // get all allowed tags across categories (unique)
      const allowedTags = await Category.distinct("tags");

      // determine invalid tags (those provided by client but not present in allowedTags)
      const invalidTags = incomingTags.filter((t) => !allowedTags.includes(t));

      if (invalidTags.length > 0) {
        return res.status(400).json({
          isSuccess: false,
          message: `Invalid interests: ${invalidTags.join(", ")}`,
          data: null,
        });
      }

      // All provided tags are valid. Store them on the user as strings (tags).
      // If you prefer to store Category ObjectIds instead, see comments below.
      user.interests = incomingTags;
      // NOTE: If your User schema expects ObjectIds for interests, replace the above with mapping logic
      // to map each tag -> category._id (decide how to handle duplicate tags across multiple categories).
    }

    // --- Availability ---
    if (Array.isArray(availability) && availability.length > 0) {
      // optional: validate shape of availability entries if you have a defined structure
      user.availability = availability;
    }

    // Save user
    await user.save();

    // After successfully saving the new image, delete the old Cloudinary image if it exists and is different
    try {
      if (oldPublicId && newPublicId && oldPublicId !== newPublicId) {
        await deleteCloudinaryImage(oldPublicId);
      } else if (oldPublicId && typeof newImageObjOrUrl === "string") {
        // New image provided by client but we couldn't extract its public id; still delete old if it was Cloudinary
        await deleteCloudinaryImage(oldPublicId);
      }
      // else: no deletion needed
    } catch (delErr) {
      console.error(
        "Failed to delete previous Cloudinary image (non-fatal):",
        delErr
      );
    }

    // Prepare response interests:
    // If interests were stored as ObjectIds you may want to populate them before responding.
    // Here we stored tags as strings, so just return them directly.
    const responseData = {
      id: user._id,
      uid: user.uid,
      name: user.name,
      email: user.email,
      profile_image: getFullImageUrl(user.profile_image),
      bio: user.bio,
      city: user.city,
      languages: user.languages,
      interests: user.interests,
      availability: user.availability,
    };

    return res.json({
      isSuccess: true,
      message: "Profile updated successfully",
      data: responseData,
    });
  } catch (err) {
    console.error("editProfile error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
