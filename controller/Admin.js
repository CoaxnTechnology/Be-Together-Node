const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
const axios = require("axios");
const Category = require("../model/Category");
const User = require("../model/User");
const Service = require("../model/Service");

// Helper to upload buffer to Cloudinary
const uploadFromBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "categories" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
//--------------------------create the category ---------------------
exports.createCategory = async (req, res) => {
  try {
    const { name, tags } = req.body;
    if (!name) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Category name is required" });
    }

    let imageUrl = null;
    let imagePublicId = null;

    if (req.file) {
      try {
        const uploadResult = await uploadFromBuffer(req.file.buffer);
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id; // save public_id
      } catch (err) {
        return res
          .status(500)
          .json({ isSuccess: false, message: "Image upload failed" });
      }
    }

    // Auto-tags from OpenStreetMap
    let autoTags = [];
    try {
      const tagRes = await axios.get(
        `https://taginfo.openstreetmap.org/api/4/key/values?key=${encodeURIComponent(
          name
        )}&page=1&rp=10`
      );
      autoTags = tagRes.data.data?.map((t) => t.value).filter(Boolean) || [];
    } catch (err) {}

    const finalTags = autoTags.length > 0 ? autoTags : tags || [];

    const newCategory = new Category({
      name,
      image: imageUrl,
      imagePublicId, // save public_id
      tags: finalTags,
    });

    await newCategory.save();

    return res.status(201).json({
      isSuccess: true,
      message: "Category created",
      data: newCategory,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

// ---------------------------------GET ALL CATEGORY -------------------------------
exports.getAllCategories = async (req, res) => {
  try {
    // console.log("===== getAllCategories called =====");
    // console.log("Request query:", req.query);

    const categories = await Category.find().sort({ created_at: -1 });
    //    console.log("Categories fetched from DB:", categories.length);

    return res.status(200).json({
      isSuccess: true,
      message: "Categories fetched successfully",
      data: categories,
    });
  } catch (err) {
    // console.error("Error fetching categories:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};
//------------------------------Update Category---------------
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, tags } = req.body;

    if (!id) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Category ID is required" });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Category not found" });
    }

    // Update name and tags
    category.name = name || category.name;
    category.tags = tags || category.tags;

    // If new image is uploaded, delete old one from Cloudinary
    if (req.file) {
      if (category.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(category.imagePublicId);
        } catch (err) {
          console.error("Failed to delete old image from Cloudinary:", err);
        }
      }

      // Upload new image
      const uploadResult = await uploadFromBuffer(req.file.buffer);
      category.image = uploadResult.secure_url;
      category.imagePublicId = uploadResult.public_id;
    }

    await category.save();

    return res.status(200).json({
      isSuccess: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (err) {
    console.error("Error updating category:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

//-------------------------------------DELETE CATEGROY--------------------------
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Category not found" });
    }

    // Delete image from Cloudinary if exists
    if (category.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(category.imagePublicId);
      } catch (err) {
        console.error("Failed to delete image from Cloudinary:", err);
      }
    }

    await Category.findByIdAndDelete(id);

    return res.status(200).json({
      isSuccess: true,
      message: "Category deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting category:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};
//---------------------USer Details----------------------------
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    // ✅ Populate *all* fields from Service model
    const user = await User.findById(id)
      .populate({
        path: "services", // must match the field name in your User schema
        model: "Service", // ensure this matches your service model name
      })
      .lean();

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (err) {
    console.error("❌ Error fetching user:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

//--------------------ALL USER----------
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json({ success: true, data: users });
  } catch (err) {
    console.error("Error fetching users:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
