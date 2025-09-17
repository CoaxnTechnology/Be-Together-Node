const User = require("../model/User");
const Category = require("../model/Category");
const { getFullImageUrl } = require("../utils/image");
const streamifier = require("streamifier");
const cloudinary = require("cloudinary").v2;
// ---------------- GET Profile ----------------
exports.getUserProfileByEmail = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email }).populate("interests");

    if (!user) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found" });
    }

    res.json({
      isSuccess: true,
      message: "Profile fetched successfully",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        profile_image: getFullImageUrl(user.profile_image),
        bio: user.bio || "",
        city: user.city,
        languages: user.languages, // string array
        interests: user.interests, // populated category objects
        availability: user.availability || [], // added availability
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
function uploadBufferToCloudinary(buffer, folder = "profile_images", publicId = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      folder,
      resource_type: "image",
      overwrite: false,
      use_filename: false,
    };
    if (publicId) opts.public_id = publicId;

    const uploadStream = cloudinary.uploader.upload_stream(opts, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// Extract Cloudinary public_id from a Cloudinary secure_url (best-effort).
function extractPublicIdFromCloudinaryUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    // Try to match "/upload/.../v12345/<public_id>.<ext>"
    let m = url.match(/\/upload\/(?:.*\/)?v\d+\/(.+)\.[^/.]+$/);
    if (!m) {
      // fallback: "/upload/<public_id>.<ext>"
      m = url.match(/\/upload\/(.+)\.[^/.]+$/);
    }
    if (!m) return null;
    return decodeURIComponent(m[1]);
  } catch (e) {
    return null;
  }
}

// Delete Cloudinary image by public_id (non-fatal)
async function deleteCloudinaryImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (err) {
    console.error("deleteCloudinaryImage error (non-fatal):", err);
  }
}
// ---------------- UPDATE Profile ----------------
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

    // Identify user
    let user = null;
    if (email) {
      user = await User.findOne({ email });
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
      return res.json({
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
        const publicId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = await uploadBufferToCloudinary(req.file.buffer, "profile_images", publicId);
        newImageObjOrUrl = {
          public_id: result.public_id,
          secure_url: result.secure_url,
        };
        newPublicId = result.public_id;
      } catch (uploadErr) {
        console.error("Cloudinary upload failed in editProfile:", uploadErr);
        return res.status(500).json({ isSuccess: false, message: "Image upload failed" });
      }
    } else if (clientImageUrl && typeof clientImageUrl === "string" && clientImageUrl.trim() !== "") {
      const url = clientImageUrl.trim();
      const extracted = extractPublicIdFromCloudinaryUrl(url);
      if (extracted) {
        newImageObjOrUrl = { public_id: extracted, secure_url: url };
        newPublicId = extracted;
      } else {
        newImageObjOrUrl = url; // store raw URL if not Cloudinary or can't extract
      }
    }

    // Assign new image if present
    if (newImageObjOrUrl) {
      user.profile_image = newImageObjOrUrl;
    }

    // Languages - store directly from frontend strings (replace only if non-empty array provided)
    if (Array.isArray(languages) && languages.length > 0) {
      user.languages = languages;
    }

    // Interests - match with Category.tags
    if (Array.isArray(interests) && interests.length > 0) {
      const foundCategories = await Category.find({ tags: { $in: interests } });
      if (!foundCategories.length) {
        return res.json({
          isSuccess: false,
          message: "No matching interests found",
          data: null,
        });
      }
      user.interests = foundCategories.map((c) => c._id);
    }

    // Availability - multiple days and multiple time ranges
    if (Array.isArray(availability) && availability.length > 0) {
      user.availability = availability;
    }

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
      console.error("Failed to delete previous Cloudinary image (non-fatal):", delErr);
    }

    // populate interests only for response
    user = await user.populate("interests");

    res.json({
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
        languages: user.languages,
        interests: user.interests,
        availability: user.availability,
      },
    });
  } catch (err) {
    console.error("editProfile error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
