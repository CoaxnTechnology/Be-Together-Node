// const Category = require("../model/Category");
// const axios = require("axios");
// const cloudinary = require("cloudinary").v2;

// // Cloudinary config
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// // ✅ Create Category with auto or manual tags
// // exports.createCategory = async (req, res) => {
// //   try {
// //     const { name, tags } = req.body;
// //     let imageUrl = null;

// //     if (!name) {
// //       return res.status(400).json({ success: false, message: "Category name is required" });
// //     }

// //     // ✅ Upload image to Cloudinary (if provided)
// //     if (req.file) {
// //       const uploadResult = await cloudinary.uploader.upload(req.file.path, {
// //         folder: "categories",
// //       });
// //       imageUrl = uploadResult.secure_url;
// //     }

// //     // ✅ Try to generate tags automatically from OpenStreetMap API
// //     let autoTags = [];
// //     try {
// //       const tagResponse = await axios.get(
// //         `https://taginfo.openstreetmap.org/api/4/key/values?key=${encodeURIComponent(name)}&page=1&rp=10`
// //       );

// //       if (tagResponse.data?.data?.length > 0) {
// //         autoTags = tagResponse.data.data
// //           .slice(0, 10)
// //           .map((item) => item.value)
// //           .filter(Boolean);
// //       }
// //     } catch (err) {
// //       console.log("⚠️ TagInfo API error:", err.message);
// //     }

// //     // ✅ If autoTags are empty, use manual tags from request body
// //     const finalTags = autoTags.length > 0 ? autoTags : tags || [];

// //     // ✅ Save category in MongoDB
// //     const newCategory = new Category({
// //       name,
// //       image: imageUrl,
// //       tags: finalTags,
// //     });

// //     await newCategory.save();

// //     return res.status(201).json({
// //       success: true,
// //       message: "Category created successfully",
// //       data: newCategory,
// //     });
// //   } catch (error) {
// //     console.error("Error creating category:", error);
// //     res.status(500).json({ success: false, message: "Internal server error", error: error.message });
// //   }
// // };
// //-------------------------------GET ALL CATEGORY---------------------------------
// exports.getAllCategories = async (req, res) => {
//   try {
//     const categories = await Category.find();

//     if (!categories || categories.length === 0) {
//       return res.status(404).json({
//         isSuccess: false,
//         message: "Category not found",
//       });
//     }

//     return res.json({
//       isSuccess: true,
//       message: "Categories fetched successfully",
//       data: categories,
//     });
//   } catch (err) {
//     console.error("Error fetching categories:", err);
//     return res.status(500).json({
//       isSuccess: false,
//       message: "Server error",
//     });
//   }
// };
