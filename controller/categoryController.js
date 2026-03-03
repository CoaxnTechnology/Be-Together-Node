// controllers/categoryController.js
const Category = require("../model/Category");
const { getFullImageUrl } = require("../utils/image"); // adjust path if necessary
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const multer = require("multer");

// ---------- Cloudinary config ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Export this middleware for routes: upload.single('image')

// ---------- Helper: upload buffer to Cloudinary ----------
function uploadToCloudinary(
  buffer,
  folder = "categories",
  publicId = undefined
) {
  return new Promise((resolve, reject) => {
    const options = { folder, resource_type: "image" };
    if (publicId) options.public_id = String(publicId).replace(/\s+/g, "_");

    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// ---------- Helper: normalize tags into array of plain strings ----------
function normalizeTagsInput(tags) {
  // returns array of unique trimmed strings
  if (!tags) return [];

  let parsed = tags;

  if (typeof tags === "string") {
    const s = tags.trim();
    // Try parse JSON-stringified arrays or objects
    if (
      (s.startsWith("[") && s.endsWith("]")) ||
      (s.startsWith("{") && s.endsWith("}"))
    ) {
      try {
        parsed = JSON.parse(s);
      } catch (e) {
        // not JSON — treat as comma-separated string
        parsed = s;
      }
    }
  }

  let arr = [];
  if (Array.isArray(parsed)) {
    arr = parsed
      .map((t) => {
        if (!t && t !== 0) return null;
        if (typeof t === "string") return t.trim();
        if (typeof t === "object") {
          // Accept { name: "..." } objects
          if (t.name) return String(t.name).trim();
          // Accept Cloudinary-like objects (unlikely) — ignore otherwise
        }
        return null;
      })
      .filter(Boolean);
  } else if (typeof parsed === "string") {
    arr = parsed
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  } else {
    // unknown type
    arr = [];
  }

  // dedupe case-insensitive, preserve first-case
  const seen = new Map();
  for (const t of arr) {
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  return Array.from(seen.values());
}

// ---------- Helper: escape regex for case-insensitive search ----------
function escapeRegExp(string = "") {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Add Category (single) ----------
exports.addCategory = async (req, res) => {
  try {
    const { name, tags } = req.body;
    if (!name || !String(name).trim()) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Name is required" });
    }

    // Check duplicate by case-insensitive name
    const existing = await Category.findOne({
      name: new RegExp("^" + escapeRegExp(name.trim()) + "$", "i"),
    });
    if (existing) {
      return res.json({ isSuccess: false, message: "Category already exists" });
    }

    // Handle image upload (Cloudinary) or accept provided image/url string
    let imageUrl = null;
    if (req.file && req.file.buffer) {
      try {
        const originalName = req.file.originalname
          ? req.file.originalname.replace(/\.[^/.]+$/, "")
          : undefined;
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          "categories",
          originalName
        );
        imageUrl = getFullImageUrl(uploadResult);
      } catch (uploadErr) {
        console.error("Cloudinary upload failed:", uploadErr);
        return res
          .status(500)
          .json({ isSuccess: false, message: "Image upload failed" });
      }
    } else if (req.body.image) {
      // if client supplied image string or an object, use helper to normalize
      imageUrl = getFullImageUrl(req.body.image);
      // if imageUrl is still null, but the provided is a local path (like "/uploads/icons/x.png"), accept it:
      if (
        !imageUrl &&
        typeof req.body.image === "string" &&
        req.body.image.trim()
      ) {
        imageUrl = req.body.image
          .trim()
          .replace(/(\/uploads\/icons)+/g, "/uploads/icons");
      }
    }

    // Normalize tags into array of strings
    const tagsArray = normalizeTagsInput(tags);

    // Create & save category (tags stored as plain strings)
    const category = new Category({
      name: name.trim(),
      image: imageUrl,
      tags: tagsArray,
    });

    await category.save();

    return res.json({
      isSuccess: true,
      message: "Category added successfully",
      data: category,
    });
  } catch (err) {
    console.error("Error adding category:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// ---------- Get All Categories ----------
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find();

    if (!categories || categories.length === 0) {
      return res.status(404).json({
        isSuccess: false,
        message: "Category not found",
      });
    }

    return res.json({
      isSuccess: true,
      message: "Categories fetched successfully",
      data: categories,
    });
  } catch (err) {
    console.error("Error fetching categories:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
};
