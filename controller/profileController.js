// controller/profileController.js
const User = require("../model/User");
const Category = require("../model/Category");
const { getFullImageUrl } = require("../utils/image");
const streamifier = require("streamifier");
const cloudinary = require("cloudinary").v2;

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

function extractPublicIdFromCloudinaryUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    // match "/upload/.../v12345/<public_id>.<ext>" or fallback "/upload/<public_id>.<ext>"
    let m = url.match(/\/upload\/(?:.*\/)?v\d+\/(.+)\.[^/.]+$/);
    if (!m) m = url.match(/\/upload\/(.+)\.[^/.]+$/);
    if (!m) return null;
    return decodeURIComponent(m[1]);
  } catch (e) {
    return null;
  }
}

async function deleteCloudinaryImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (err) {
    console.error("deleteCloudinaryImage error (non-fatal):", err);
  }
}

// ---------------- GET Profile ----------------
exports.getUserProfileByEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ isSuccess: false, message: "email is required" });
    }

    const user = await User.findOne({ email }).populate("interests");

    if (!user) {
      return res.status(404).json({ isSuccess: false, message: "User not found" });
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
        city: user.city || "",
        languages: user.languages || [],
        interests: user.interests || [],
        availability: user.availability || [],
      },
    });
  } catch (err) {
    console.error("getUserProfileByEmail error:", err);
    res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};

// ---------------- UPDATE Profile ----------------
exports.editProfile = async (req, res) => {
  try {
    // don't set defaults here; we need to detect if a field was provided
    let { email, name, bio, city } = req.body;

    // helper: try parse JSON string fields (common with multipart/form-data)
    const tryParse = (val) => {
      if (typeof val !== "string") return val;
      const t = val.trim();
      if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
        try { return JSON.parse(t); } catch (e) { return val; }
      }
      return val;
    };

    const rawLanguages = tryParse(req.body.languages);
    const rawInterests = tryParse(req.body.interests);
    const rawAvailability = tryParse(req.body.availability);

    // Identify user
    let user = null;
    if (email) {
      user = await User.findOne({ email });
    } else if (req.user && req.user.id) {
      user = await User.findById(req.user.id);
    }

    if (!user) {
      return res.status(404).json({ isSuccess: false, message: "User not found", data: null });
    }

    // Basic fields
    if (typeof name === "string" && name.trim() === "") {
      return res.status(400).json({ isSuccess: false, message: "Name cannot be empty", data: null });
    }
    if (typeof name === "string" && name.trim() !== "") user.name = name.trim();
    if (typeof bio === "string") user.bio = bio.trim();
    if (typeof city === "string") user.city = city.trim();

    // keep track of old Cloudinary public_id (if any) to delete later
    let oldPublicId = null;
    if (user.profile_image) {
      if (typeof user.profile_image === "string") {
        oldPublicId = extractPublicIdFromCloudinaryUrl(user.profile_image);
      } else if (user.profile_image && user.profile_image.public_id) {
        oldPublicId = user.profile_image.public_id;
      }
    }

    // ---------- Image upload handling ----------
    if (req.file && req.file.buffer) {
      try {
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
          throw new Error("Cloudinary not configured (missing env vars).");
        }

        const publicId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = await uploadBufferToCloudinary(req.file.buffer, "profile_images", publicId);

        if (!result || !result.secure_url) {
          throw new Error("Invalid upload response from Cloudinary");
        }

        // Save the URL string in DB (as requested)
        user.profile_image = result.secure_url;

        // Save public_id too for later deletion (optional field on User schema)
        user.profile_image_public_id = result.public_id || publicId;

        // Delete old Cloudinary image when replaced
        if (oldPublicId && result.public_id && oldPublicId !== result.public_id) {
          try { await deleteCloudinaryImage(oldPublicId); } catch (e) { console.error(e); }
        }
      } catch (uploadErr) {
        console.error("Cloudinary upload failed in editProfile:", uploadErr);
        return res.status(500).json({ isSuccess: false, message: "Image upload failed", error: uploadErr.message });
      }
    }

    // If client passed a profile_image URL (rare case), accept it (but we prefer file uploads)
    if (!req.file && req.body.profile_image && typeof req.body.profile_image === "string" && req.body.profile_image.trim() !== "") {
      const url = req.body.profile_image.trim();
      user.profile_image = url;
      const extracted = extractPublicIdFromCloudinaryUrl(url);
      if (extracted) user.profile_image_public_id = extracted;
    }

    // ---------- Other fields ----------
    // Languages
    if (rawLanguages !== undefined) {
      if (!Array.isArray(rawLanguages)) {
        return res.status(400).json({ isSuccess: false, message: "languages must be an array" });
      }
      user.languages = rawLanguages;
    }

    // Interests -> match Category.tags
    if (rawInterests !== undefined) {
      if (!Array.isArray(rawInterests)) {
        return res.status(400).json({ isSuccess: false, message: "interests must be an array" });
      }
      if (rawInterests.length === 0) {
        user.interests = [];
      } else {
        // ensure tags are strings — consider normalizing case if needed
        const foundCategories = await Category.find({ tags: { $in: rawInterests } });
        if (!foundCategories.length) {
          return res.status(400).json({ isSuccess: false, message: "No matching interests found", data: null });
        }
        user.interests = foundCategories.map((c) => c._id);
      }
    }

    // Availability
    if (rawAvailability !== undefined) {
      if (!Array.isArray(rawAvailability)) {
        return res.status(400).json({ isSuccess: false, message: "availability must be an array" });
      }
      user.availability = rawAvailability;
    }

    await user.save();

    // populate interests for response
    user = await user.populate("interests");

    return res.json({
      isSuccess: true,
      message: "Profile updated successfully",
      data: {
        id: user._id,
        uid: user.uid,
        name: user.name,
        email: user.email,
        profile_image: getFullImageUrl(user.profile_image), // should return secure_url string
        bio: user.bio,
        city: user.city,
        languages: user.languages || [],
        interests: user.interests || [],
        availability: user.availability || [],
      },
    });
  } catch (err) {
    console.error("editProfile error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};
