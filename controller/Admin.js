const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
const axios = require("axios");
const Category = require("../model/Category");
const User = require("../model/User");
const Service = require("../model/Service");
require("dotenv").config();
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
      return res.status(400).json({
        isSuccess: false,
        message: "Category name is required",
      });
    }

    // 🧱 Prevent duplicate category names
    const existing = await Category.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
    });
    if (existing) {
      return res.status(400).json({
        isSuccess: false,
        message: "Category with this name already exists",
      });
    }

    // ✅ Upload image if provided
    let imageUrl = null;
    let imagePublicId = null;

    if (req.file) {
      try {
        const uploadResult = await uploadFromBuffer(req.file.buffer);
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (err) {
        console.error("Image upload error:", err);
        return res
          .status(500)
          .json({ isSuccess: false, message: "Image upload failed" });
      }
    }

    // ✅ Fetch AI tags from HrFlow
    // Fetch AI tags
const getHrFlowTags = async (text) => {
  try {
    const response = await axios.post(
      "https://api.hrflow.ai/v1/text/tagging",
      {
        algorithm_key: "tagger-rome-family",
        text: text,
        top_n: 10,
        output_lang: "en",
      },
      {
        headers: {
          "X-API-KEY": process.env.HRFLOW_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("HrFlow tagging response:", response.data);
    return response.data.data?.tags?.map((t) => t.name) || [];
  } catch (err) {
    console.error("HrFlow tagging error:", err.response?.data || err.message);
    return [];
  }
};

// ✅ Actually call it
let autoTags = await getHrFlowTags(name);
console.log("Auto tags fetched:", autoTags);


    // ✅ Merge manual + AI tags
    let userTags = [];
    if (Array.isArray(tags)) userTags = tags;
    else if (typeof tags === "string") {
      try {
        userTags = JSON.parse(tags);
      } catch {
        userTags = [tags];
      }
    }

    const finalTags = [...new Set([...autoTags, ...userTags])].filter(Boolean);
    console.log("✅ Final Tags to Save:", finalTags);

    // ✅ Save the new category
    const newCategory = new Category({
      name,
      image: imageUrl,
      imagePublicId,
      tags: finalTags,
    });

    await newCategory.save();

    return res.status(201).json({
      isSuccess: true,
      message: "Category created successfully",
      data: newCategory,
    });
  } catch (err) {
    console.error("❌ createCategory error:", err);
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
    let { name, tags } = req.body;

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

    // ✅ Update name and tags safely
    category.name = name || category.name;

    // ✅ Convert tags string (like '["spa"]') to array
    if (typeof tags === "string") {
      try {
        category.tags = JSON.parse(tags);
      } catch {
        category.tags = [];
      }
    } else {
      category.tags = tags || category.tags;
    }

    // ✅ Handle image update
    if (req.file) {
      if (category.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(category.imagePublicId);
        } catch (err) {
          console.error("Failed to delete old image from Cloudinary:", err);
        }
      }

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

    const user = await User.findById(id)
      .populate({
        path: "services",
        model: "Service",
        populate: [
          { path: "category", select: "name" },
          { path: "owner", select: "name" },
        ],
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
//--------------------ALL SERVICES----------
exports.getAllService = async (req, res) => {
  try {
    const services = await Service.find()
      .populate("category", "name")
      .populate("owner", "name");
    //console.log(services);
    // services.forEach(s => {
    //   console.log(s.title, s.owner); // dekho kaunse null aa rahe
    // });
    res.json({ success: true, data: services });
  } catch (err) {
    console.error("Error fetching services:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
//--------------------Service By ID----------
exports.getServiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await Service.findById(id)
      .populate("category", "name") // only get the category name
      .populate("owner", "name email");
    res.json({ success: true, data: service });
  } catch (err) {
    console.error("Error fetching service:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
