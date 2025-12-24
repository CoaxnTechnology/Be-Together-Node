const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
const axios = require("axios");
const Category = require("../model/Category");
const User = require("../model/User");
const Service = require("../model/Service");
const { getFullImageUrl } = require("../utils/image");
const Review = require("../model/review");
const moment = require("moment");
require("dotenv").config();
const Admin = require("../model/Admin");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const csv = require("csv-parser");
const Booking = require("../model/Booking");
const Payment = require("../model/Payment");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// ------------------ Cloudinary Config ------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 📤 Upload buffer to Cloudinary
const uploadFromBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "categories" },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

// 🧠 Deduplicate tags with similarity check
function deduplicateSimilarTags(tags) {
  const unique = [];
  for (const tag of tags) {
    const normalized = tag.toLowerCase().trim();
    if (
      !unique.some(
        (t) =>
          t === normalized ||
          t.startsWith(normalized.slice(0, 5)) ||
          normalized.startsWith(t.slice(0, 5))
      )
    ) {
      unique.push(normalized);
    }
  }
  return unique;
}

// 🤖 Fetch AI tags from HrFlow
// 🤖 Fetch AI tags from HrFlow
const getHrFlowTags = async (text) => {
  if (!process.env.HRFLOW_API_KEY) {
    console.warn("⚠️ HRFLOW_API_KEY not set");
    return [];
  }

  console.log("➡️ Sending text to HrFlow for tags:", text);

  try {
    const response = await axios.post(
      "https://api.hrflow.ai/v1/text/linking",
      {
        algorithm_key: "tagger-rome-family",
        text,
        top_n: 30,
        output_lang: "en",
      },
      {
        headers: {
          "X-API-KEY": process.env.HRFLOW_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("⬅️ HrFlow raw response:", response.data);

    const arr = response.data?.data || [];
    const tags = arr.map((t) => t[0]?.trim().toLowerCase()).filter(Boolean);
    console.log("✅ Extracted AI tags:", tags);

    return [...new Set(tags)];
  } catch (err) {
    console.error(
      "❌ HrFlow tagging error:",
      err.response?.data || err.message
    );
    return [];
  }
};

// ------------------ CREATE CATEGORY ------------------
exports.createCategory = async (req, res) => {
  try {
    const { name, tags } = req.body;

    if (!name?.trim())
      return res
        .status(400)
        .json({ isSuccess: false, message: "Category name is required" });

    // Prevent duplicate names
    const existing = await Category.findOne({
      name: { $regex: `^${name}$`, $options: "i" },
    });
    if (existing)
      return res
        .status(400)
        .json({ isSuccess: false, message: "Category already exists" });

    // Upload image if provided
    let imageUrl = null,
      imagePublicId = null;
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

    // AI tags
    const autoTags = await getHrFlowTags(name);

    // Manual tags
    let userTags = [];
    if (Array.isArray(tags)) userTags = tags;
    else if (typeof tags === "string") {
      try {
        userTags = JSON.parse(tags);
      } catch {
        userTags = [tags];
      }
    }

    // Merge & deduplicate
    let finalTags = [
      ...new Set(
        [...autoTags, ...userTags.map((t) => t.trim().toLowerCase())].filter(
          Boolean
        )
      ),
    ];
    finalTags = deduplicateSimilarTags(finalTags);

    // Save category
    const newCategory = new Category({
      name,
      image: imageUrl,
      imagePublicId,
      tags: finalTags,
    });
    try {
      await newCategory.save();
    } catch (err) {
      // Rollback image if DB fails
      if (imagePublicId) await cloudinary.uploader.destroy(imagePublicId);
      throw err;
    }

    return res.status(201).json({
      isSuccess: true,
      message: "Category created successfully",
      data: newCategory,
      autoTags,
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

// ------------------ GET AI TAGS ------------------
exports.getAITags = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim())
      return res
        .status(400)
        .json({ isSuccess: false, message: "Text is required" });

    const tags = await getHrFlowTags(text);
    console.log("AI tags generated:", tags);
    return res.status(200).json({ isSuccess: true, tags });
  } catch (err) {
    console.error("AI tag generation error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, message: "Failed to generate tags" });
  }
};

// ---------------------------------GET ALL CATEGORY With Pagination-------------------------------
exports.getAllCategories = async (req, res) => {
  try {
    // Read page and limit from request body (default to 1 and 10)
    const body = req.body || {};
    const page = parseInt(body.page) || 1;
    const limit = parseInt(body.limit) || 10;
    const skip = (page - 1) * limit;

    // Count total categories
    const total = await Category.countDocuments();

    // Fetch paginated categories, sorted by creation date
    const categories = await Category.find()
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    // Format categories to remove unwanted fields
    const formattedCategories = categories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      image: cat.image,
      tags: cat.tags || [],
      imagePublicId: cat.imagePublicId || null,
      created_at: cat.created_at,
      categoryId: cat.categoryId,
      provider_share: cat.provider_share || 0,
      seeker_share: cat.seeker_share || 0,
      discount_percentage: cat.discount_percentage || 0,
    }));

    // Send response
    return res.status(200).json({
      isSuccess: true,
      message: "Categories fetched successfully",
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: formattedCategories,
    });
  } catch (err) {
    console.error("getAllCategories error:", err);
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

//-------------------------------------DELETE CATEGROY from admin--------------------------
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
const mongoose = require("mongoose");

exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid user id: ${id}`,
      });
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

//--------------------ALL REAL  USER----------
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({
      $or: [
        { is_fake: false },
        { is_fake: { $exists: false } }, // include users without the field
      ],
    }).select("name email mobile city age profile_image created_at status");
    res.json({ success: true, data: users });
    //  console.log("Get all users called",users);
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

//--------------------Generate Users from CSV-------------------
//const csv = require("csv-parser");
const { Readable } = require("stream");

// ✅ Check valid image URL
function isValidImageUrl(url) {
  return (
    typeof url === "string" &&
    /^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i.test(url)
  );
}

// ✅ Upload image URL to Cloudinary
async function uploadImageFromUrlToCloudinary(imageUrl, folder) {
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
  });

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(response.data).pipe(uploadStream);
  });
}


exports.generateUsersFromCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No CSV file uploaded",
      });
    }

    const bufferStream = new Readable();
    bufferStream.push(req.file.buffer);
    bufferStream.push(null);

    const usersData = [];
    const createdUsers = [];
    const skippedUsers = [];

    bufferStream
      .pipe(csv())
      .on("data", (row) => usersData.push(row))
      .on("end", async () => {
        for (const row of usersData) {
          try {
            // ✅ Check Email Duplicate
            const existingUser = await User.findOne({ email: row.email });
            if (existingUser) {
              console.warn(`⚠️ Email exists: ${row.email}`);
              skippedUsers.push({
                email: row.email,
                reason: "Duplicate Email",
              });
              continue; // Skip this user
            }
            // 1️⃣ VALIDATE CATEGORY + TAGS BASED ON YOUR SCHEMA
            // ---------------------------------------------------
            let services = [];

            // Try parsing services JSON
            try {
              services = JSON.parse(row.services || "[]");
            } catch (err) {
              skippedUsers.push({
                email: row.email,
                reason: "Invalid services JSON",
              });
              continue;
            }

            let isValidUser = true;
            // let isValidUser = true;

            for (const s of services) {
              // ✅ Check categoryId exists
              if (!s.categoryId) {
                isValidUser = false;
                skippedUsers.push({
                  email: row.email,
                  reason: "Missing categoryId in service",
                });
                break;
              }

              // 🔍 Check category exists in DB using correct type (string)
              const category = await Category.findById(s.categoryId);
              if (!category) {
                isValidUser = false;
                skippedUsers.push({
                  email: row.email,
                  reason: `Invalid CategoryId: ${s.categoryId}`,
                });
                break;
              }

              // 🔍 Validate tags inside category.tags[]
              if (Array.isArray(s.selectedTags)) {
                for (const tag of s.selectedTags) {
                  if (!category.tags.includes(tag)) {
                    isValidUser = false;
                    skippedUsers.push({
                      email: row.email,
                      reason: `Tag '${tag}' does not exist in Category '${category.name}'`,
                    });
                    break;
                  }
                }
              }

              if (!isValidUser) break;
            }

            // If category/tags invalid → skip user
            if (!isValidUser) continue;

            const user = new User({
              name: row.name,
              email: row.email,
              mobile: row.mobile || null,
              profile_image: row.profile_image || null,
              bio: row.bio || null,
              city: row.city || null,
              age: row.age ? Number(row.age) : null,
              is_fake: String(row.is_fake).trim().toLowerCase() === "true",
              languages: row.languages
                ? row.languages.split(",").map((l) => l.trim())
                : [],
              interests: row.interests
                ? row.interests.split(",").map((i) => i.trim())
                : [],
              offeredTags: row.offeredTags
                ? row.offeredTags.split(",").map((t) => t.trim())
                : [],
              lastLocation: {
                coords: {
                  type: "Point",
                  coordinates: [
                    parseFloat(row.lastLocation_longitude) || 0,
                    parseFloat(row.lastLocation_latitude) || 0,
                  ],
                },
                provider: row.lastLocation_type || null,
              },
              is_active: true,
              register_type: "manual",
              login_type: "manual",
            });

            const savedUser = await user.save();

            services = JSON.parse(row.services || "[]");
            const createdServices = [];

            for (const s of services) {
              const serviceData = {
                title: s.title || "Untitled Service",
                Language: s.Language || "English",
                city: s.city || savedUser.city || "Unknown",
                isFree: s.isFree === "true" || s.isFree === true,
                price: s.price ? Number(s.price) : 0,
                description: s.description || "No description",
                category: s.categoryId,
                tags: s.selectedTags || [],
                max_participants: s.max_participants
                  ? Number(s.max_participants)
                  : 1,
                service_type: s.service_type || "one_time",
                owner: savedUser._id,
                location_name: s.location?.name || "Unknown",
                location: {
                  type: "Point",
                  coordinates: [
                    parseFloat(s.location?.longitude) || 0,
                    parseFloat(s.location?.latitude) || 0,
                  ],
                },
              };

              if (s.service_type === "one_time" && s.date) {
                serviceData.date = s.date;
                serviceData.start_time = s.start_time;
                serviceData.end_time = s.end_time;
              }

              if (s.service_type === "recurring" && Array.isArray(s.schedule)) {
                serviceData.recurring_schedule = s.schedule.map((slot) => ({
                  day: new Date(slot.date).toLocaleDateString("en-US", {
                    weekday: "long",
                  }),
                  start_time: slot.start_time,
                  end_time: slot.end_time,
                  date: slot.date,
                }));
              } else if (s.service_type === "recurring" && s.date) {
                serviceData.recurring_schedule = [
                  {
                    day: new Date(s.date).toLocaleDateString("en-US", {
                      weekday: "long",
                    }),
                    start_time: s.start_time,
                    end_time: s.end_time,
                    date: s.date,
                  },
                ];
              }
              // ================= IMAGE LOGIC =================
let serviceImage = null;
let serviceImagePublicId = null;

// 🔹 Case 1: CSV service image URL provided
if (s.image && isValidImageUrl(s.image)) {
  try {
    const uploadResult = await uploadImageFromUrlToCloudinary(
      s.image,
      "service_images"
    );
    serviceImage = uploadResult.secure_url;
    serviceImagePublicId = uploadResult.public_id;
  } catch (err) {
    console.error("❌ Service image upload failed:", err.message);
  }
}

// 🔹 Case 2: No image → use category image
if (!serviceImage) {
  const category = await Category.findById(s.categoryId);
  if (category?.image) {
    serviceImage = category.image;
    serviceImagePublicId = category.imagePublicId || null;
  }
}

// 🔹 Assign to serviceData
serviceData.image = serviceImage;
serviceData.imagePublicId = serviceImagePublicId;
// =================================================


              const service = new Service(serviceData);
              const savedService = await service.save();
              createdServices.push(savedService._id);
            }

            savedUser.services = createdServices;
            await savedUser.save();

            createdUsers.push({
              user: { id: savedUser._id, name: savedUser.name },
              services: createdServices.length,
            });
          } catch (err) {
            console.error("❌ Error:", err.message);
            skippedUsers.push({
              email: row.email,
              reason: "Error in saving user/service",
            });
          }
        }

        bufferStream
          .pipe(csv())
          .on("data", (row) => {
            bufferStream.pause(); // pause stream
            processRow(row).finally(() => bufferStream.resume()); // resume after processing
          })
          .on("end", () => {
            res.json({
              success: true,
              message: "CSV processed ✅",
              createdCount: createdUsers.length,
              skippedCount: skippedUsers.length,
              createdUsers,
              skippedUsers,
            });
          });
      });
  } catch (err) {
    console.error("generateUsersFromCSV error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ✅ Get all fake users
exports.getFakeUsers = async (req, res) => {
  try {
    const fakeUsers = await User.find({ is_fake: true }).select(
      "name email mobile city age profile_image created_at"
    );

    res.json({
      success: true,
      count: fakeUsers.length,
      data: fakeUsers,
    });
  } catch (err) {
    console.error("Error fetching fake users:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};
//--------------------Delete Fake Users-------------------

exports.deleteFakeUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.is_fake) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot delete real user" });
    }

    // ====== Find all services owned by this user ======
    const services = await Service.find({ owner: id });
    const serviceIds = services.map((s) => s._id);

    // ====== Delete related reviews ======
    await Review.deleteMany({
      $or: [
        { user: id }, // reviews written by this user
        { service: { $in: serviceIds } }, // reviews on the user’s services
      ],
    });

    // ====== Delete services owned by the user ======
    await Service.deleteMany({ owner: id });

    // ====== Delete the user itself ======
    await User.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: "Fake user, related services, and reviews deleted successfully",
    });
  } catch (err) {
    console.error("Delete Fake User Error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
//---------------------DELETE ALL FAKE USERS----------------------------
exports.deleteAllFakeUsers = async (req, res) => {
  try {
    // 1️⃣ Fetch all fake users
    const fakeUsers = await User.find({ is_fake: true });

    if (fakeUsers.length === 0) {
      return res.json({
        success: true,
        message: "No fake users found",
      });
    }

    // 2️⃣ Get all fake user IDs
    const fakeUserIds = fakeUsers.map((u) => u._id);

    // 3️⃣ Get all services owned by fake users
    const services = await Service.find({ owner: { $in: fakeUserIds } });
    const serviceIds = services.map((s) => s._id);

    // 4️⃣ Delete reviews written by fake users OR on their services
    await Review.deleteMany({
      $or: [{ user: { $in: fakeUserIds } }, { service: { $in: serviceIds } }],
    });

    // 5️⃣ Delete services owned by fake users
    await Service.deleteMany({ owner: { $in: fakeUserIds } });

    // 6️⃣ Delete fake users
    await User.deleteMany({ _id: { $in: fakeUserIds } });

    return res.json({
      success: true,
      deletedFakeUsers: fakeUsers.length,
      deletedServices: serviceIds.length,
      message: "All fake users and their related services & reviews deleted",
    });
  } catch (err) {
    console.error("Delete All Fake Users Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// ---------------- UPDATE Profile ----------------

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadBufferToCloudinary(
  buffer,
  folder = "profile_images",
  publicId = null
) {
  return new Promise((resolve, reject) => {
    const opts = { folder, resource_type: "image", overwrite: false };
    if (publicId) opts.public_id = publicId;

    const uploadStream = cloudinary.uploader.upload_stream(
      opts,
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

function extractPublicIdFromCloudinaryUrl(url) {
  if (!url) return null;
  const m =
    url.match(/\/upload\/(?:.*\/)?v\d+\/(.+)\.[^/.]+$/) ||
    url.match(/\/upload\/(.+)\.[^/.]+$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function deleteCloudinaryImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (err) {
    console.error("deleteCloudinaryImage error:", err);
  }
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

exports.editProfile = async (req, res) => {
  try {
    // console.log("req.body:", req.body);
    //console.log("req.file:", req.file);

    let {
      email,
      name,
      bio,
      city,
      age,
      languages,
      interests,
      offeredTags,
      location,
    } = req.body;

    // Parse JSON fields if needed
    languages =
      typeof languages === "string" ? JSON.parse(languages) : languages;
    interests =
      typeof interests === "string" ? JSON.parse(interests) : interests;
    offeredTags =
      typeof offeredTags === "string" ? JSON.parse(offeredTags) : offeredTags;
    location = typeof location === "string" ? JSON.parse(location) : location;

    const user = await User.findById(req.params.userId);
    if (!user)
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found" });

    // Update basic fields
    if (name) user.name = name.trim();
    if (bio) user.bio = bio.trim();
    if (city) user.city = city.trim();
    if (age !== undefined) user.age = Number(age);

    // ---------- Image Upload ----------
    if (req.file?.buffer) {
      const oldPublicId = user.profile_image_public_id;
      const publicId = `user_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const result = await uploadBufferToCloudinary(
        req.file.buffer,
        "profile_images",
        publicId
      );
      //console.log("Cloudinary upload result:", result);
      user.profile_image = result.secure_url;
      user.profile_image_public_id = result.public_id;

      // Delete old image
      if (oldPublicId && oldPublicId !== result.public_id) {
        await deleteCloudinaryImage(oldPublicId);
      }
    }

    // ---------- Languages, Interests, OfferedTags ----------
    if (Array.isArray(languages)) user.languages = languages;

    if (Array.isArray(interests) && interests.length > 0) {
      const tagRegexes = interests.map(
        (t) => new RegExp(`^${escapeRegExp(t)}$`, "i")
      );
      const foundCategories = await Category.find({
        tags: { $in: tagRegexes },
      });
      const canonical = foundCategories.flatMap((c) => c.tags);
      user.interests = interests.filter((t) => canonical.includes(t));
    }

    if (Array.isArray(offeredTags) && offeredTags.length > 0) {
      const tagRegexes = offeredTags.map(
        (t) => new RegExp(`^${escapeRegExp(t)}$`, "i")
      );
      const foundCategories = await Category.find({
        tags: { $in: tagRegexes },
      });
      const canonical = foundCategories.flatMap((c) => c.tags);
      user.offeredTags = offeredTags.filter((t) => canonical.includes(t));
    }

    // ---------- Location ----------
    if (location?.coordinates?.length === 2) {
      user.lastLocation = {
        coords: {
          type: "Point",
          coordinates: [
            Number(location.coordinates[0]),
            Number(location.coordinates[1]),
          ],
        },
        provider: location.provider || "frontend",
        recordedAt: new Date(),
        updatedAt: new Date(),
      };
      //   console.log("Last location saved:", user.lastLocation);
    }

    await user.save();
    //  console.log("User updated:", user);

    return res.json({
      isSuccess: true,
      message: "Profile updated successfully",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        profile_image: user.profile_image,
        bio: user.bio,
        city: user.city,
        languages: user.languages || [],
        interests: user.interests || [],
        offeredTags: user.offeredTags || [],
        location: user.lastLocation || null,
      },
    });
  } catch (err) {
    console.error("editProfile error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, message: "Server error", error: err.message });
  }
};

exports.getFakeUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }
    const user = await User.findById(id).lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    console.error("Error fetching fake user:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
//---------------------create service-------------------
function tryParse(val) {
  if (val === undefined || val === null) return val;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return val;
  }
}



// edit service API
exports.updateService = async (req, res) => {
  try {
    console.log("===== updateService (PATCH) called =====");
    console.log("Request body:", req.body);

    const { serviceId, userId, ...body } = req.body;

    // 🔐 Role from auth middleware
    const role = req.user?.role; // "admin" | "user"
    const adminId = req.user?.id;

    if (!serviceId) {
      return res.status(400).json({
        isSuccess: false,
        message: "serviceId is required",
      });
    }

    // =========================
    // 🔎 FETCH SERVICE
    // =========================
    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        isSuccess: false,
        message: "Service not found",
      });
    }

    let user = null;

    // =========================
    // 👤 USER FLOW
    // =========================
    if (role === "user") {
      if (!userId) {
        return res.status(400).json({
          isSuccess: false,
          message: "userId is required",
        });
      }

      user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          isSuccess: false,
          message: "User not found",
        });
      }

      if (!user.is_active) {
        return res.status(403).json({
          isSuccess: false,
          message: "User is not active",
        });
      }

      // 🚫 User can edit only own service
      if (String(service.owner) !== String(user._id)) {
        return res.status(403).json({
          isSuccess: false,
          message: "Not authorized to edit this service",
        });
      }
    }

    // =========================
    // 👑 ADMIN FLOW
    // =========================
    if (role === "admin") {
      const admin = await Admin.findById(adminId);
      if (!admin) {
        return res.status(401).json({
          isSuccess: false,
          message: "Admin not authorized",
        });
      }
      // ✅ No ownership check for admin
    }

    // =========================
    // 🧩 BUILD UPDATE PAYLOAD
    // =========================
    const updatePayload = {};

    // Title
    if (body.title) updatePayload.title = body.title.trim();

    // Description
    if (body.description) updatePayload.description = body.description;

    // Doorstep
    if (body.isDoorstepService !== undefined) {
      updatePayload.isDoorstepService =
        body.isDoorstepService === true || body.isDoorstepService === "true";
    }

    // Free / Price
    if (body.isFree !== undefined) {
      updatePayload.isFree = body.isFree === true || body.isFree === "true";
    }

    if (body.price !== undefined) {
      updatePayload.price = Number(body.price || 0);
    }

    // Currency
    if (body.currency) {
      updatePayload.currency = body.currency;

      // Only user currency update (not admin)
      if (user) {
        user.currency = body.currency;
        await user.save();
      }
    }

    // Language
    if (body.language || body.Language) {
      updatePayload.Language = body.language || body.Language;
    }

    // =========================
    // 📍 LOCATION
    // =========================
    if (body.location) {
      const location = tryParse(body.location);
      if (
        location &&
        location.latitude != null &&
        location.longitude != null &&
        location.name
      ) {
        updatePayload.location_name = location.name;
        updatePayload.location = {
          type: "Point",
          coordinates: [Number(location.longitude), Number(location.latitude)],
        };
      } else {
        return res.status(400).json({
          isSuccess: false,
          message: "Invalid location format",
        });
      }
    }

    // =========================
    // 🏷 CATEGORY & TAGS
    // =========================
    if (body.categoryId) {
      const category = await Category.findById(body.categoryId);
      if (!category) {
        return res.status(404).json({
          isSuccess: false,
          message: "Category not found",
        });
      }

      updatePayload.category = category._id;

      const selectedTags = tryParse(body.selectedTags) || [];
      const validTags = category.tags.filter((tag) =>
        selectedTags
          .map((t) => String(t).toLowerCase())
          .includes(tag.toLowerCase())
      );

      if (validTags.length) updatePayload.tags = validTags;
    }

    // =========================
    // ⏱ TIME / SCHEDULE
    // =========================
    if (body.service_type)
      updatePayload.service_type = body.service_type || "one_time";

    if (body.date) updatePayload.date = String(body.date);
    if (body.start_time)
      updatePayload.start_time = body.start_time.trim().toUpperCase();
    if (body.end_time)
      updatePayload.end_time = body.end_time.trim().toUpperCase();

    if (body.recurring_schedule) {
      updatePayload.recurring_schedule =
        tryParse(body.recurring_schedule) || [];
    }

    if (body.max_participants) {
      updatePayload.max_participants = Number(body.max_participants);
    }

    // =========================
    // 🖼 IMAGE
    // =========================
    if (req.file && req.file.buffer) {
      if (service.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(service.imagePublicId);
        } catch (err) {
          console.log("Old image delete failed:", err.message);
        }
      }

      const uploadResult = await uploadBufferToCloudinary(
        req.file.buffer,
        "service_images"
      );

      updatePayload.image = uploadResult.secure_url;
      updatePayload.imagePublicId = uploadResult.public_id;
    } else if (body.removeImage === true || body.removeImage === "true") {
      if (service.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(service.imagePublicId);
        } catch (err) {}
      }

      const serviceCategory = await Category.findById(service.category);
      updatePayload.image = serviceCategory?.image || null;
      updatePayload.imagePublicId = serviceCategory?.imagePublicId || null;
    }

    // =========================
    // ✅ UPDATE
    // =========================
    const updatedService = await Service.findByIdAndUpdate(
      serviceId,
      { $set: updatePayload },
      { new: true }
    );

    return res.json({
      isSuccess: true,
      message: "Service updated successfully",
      data: updatedService,
    });
  } catch (err) {
    console.error("updateService error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};


// Admin Login
const { createAccessToken } = require("../utils/jwt");

exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({
      success: false,
      error: "Email and password required",
    });

  try {
    const admin = await Admin.findOne({ email });
    if (!admin)
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });

    if (!admin.is_active)
      return res.status(403).json({
        success: false,
        error: "Admin account inactive",
      });

    const isMatch = await bcrypt.compare(password, admin.hashed_password);
    if (!isMatch)
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });

    // ✅ TOKEN CREATED FROM SAME SOURCE
    const token = createAccessToken({
      id: admin._id,
      email: admin.email,
    });

    res.json({
      success: true,
      message: "Login successful",
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
      },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

//admin booking
exports.getAllBookings = async (req, res) => {
  try {
    // 1️⃣ Fetch all bookings with populated references
    const bookings = await Booking.find()
      .populate("customer")
      .populate("provider")
      .populate("service")
      .populate("paymentId")
      .sort({ createdAt: -1 });

    // 2️⃣ Group bookings by service
    const groupedByService = {};

    bookings.forEach((booking) => {
      // 🛑 SAFETY CHECK (VERY IMPORTANT)
      if (!booking.service || !booking.customer || !booking.provider) {
        console.log(
          "⚠️ Skipping booking due to missing reference:",
          booking._id
        );
        return;
      }

      const serviceId = booking.service._id.toString();

      // 3️⃣ Create service group if not exists
      if (!groupedByService[serviceId]) {
        groupedByService[serviceId] = {
          service: booking.service,
          provider: booking.provider,
          users: [],
        };
      }

      // 4️⃣ Push customer + booking details
      groupedByService[serviceId].users.push({
        _id: booking.customer._id,
        name: booking.customer.name,
        email: booking.customer.email,
        phone: booking.customer.phone || null,
        profile_image: booking.customer.profile_image || null,

        // booking fields
        bookingId: booking._id,
        status: booking.status,
        amount: booking.amount,
        otp: booking.otp,
        otpExpiry: booking.otpExpiry,
        cancelledBy: booking.cancelledBy,
        cancelReason: booking.cancelReason,
        cancellationFee: booking.cancellationFee,
        refundAmount: booking.refundAmount,
        payment: booking.paymentId || null,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      });
    });

    // 5️⃣ Response
    return res.status(200).json({
      isSuccess: true,
      message: "All bookings grouped by service",
      services: Object.values(groupedByService),
    });
  } catch (error) {
    console.error("❌ getAllBookings Error:", error);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

//--------------------Payment INformation-------------------
exports.getAllPayments = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 20,
      status,
      currency,
      providerId,
      userId,
    } = req.query;

    page = Number(page);
    limit = Number(limit);

    const query = {};

    // --------- OPTIONAL FILTERS ---------
    if (status) query.status = status;
    if (currency) query.currency = currency;
    if (providerId) query.provider = providerId;
    if (userId) query.user = userId;

    // --------- FETCH PAYMENTS ----------
    const payments = await Payment.find(query)
      .populate("user", "name email phone")
      .populate("provider", "name email phone")
      .populate("service", "title description price isFree")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Payment.countDocuments(query);

    // --------- RESPONSE ----------
    return res.json({
      isSuccess: true,
      message: "All payments fetched successfully",
      totalPayments: total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),

      data: payments.map((p) => ({
        paymentId: p._id,
        bookingId: p.bookingId || null,

        customer: {
          id: p.user?._id || null,
          name: p.user?.name || null,
          email: p.user?.email || null,
          phone: p.user?.phone || null,
        },

        provider: {
          id: p.provider?._id || null,
          name: p.provider?.name || null,
          email: p.provider?.email || null,
          phone: p.provider?.phone || null,
        },

        service: {
          id: p.service?._id || null,
          title: p.service?.title || null,
          description: p.service?.description || null,
          price: p.service?.price || null,
          isFree: p.service?.isFree || false,
        },

        amount: p.amount,
        currency: p.currency,
        appCommission: p.appCommission,
        providerAmount: p.providerAmount,

        // --------- PAYMENT STATUS ---------
        paymentStatus: p.status || "unknown",

        refundId: p.refundId,
        refundReason: p.refundReason,

        checkoutSessionId: p.checkoutSessionId,
        paymentIntentId: p.paymentIntentId,
        customerStripeId: p.customerStripeId,
        providerStripeId: p.providerStripeId,

        createdAt: p.createdAt,
        completedAt: p.completedAt,
        refundedAt: p.refundedAt,
      })),
    });
  } catch (err) {
    console.error("getAllPayments error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};
//-----------------service delte by admin------
exports.adminForceDeleteService = async (req, res) => {
  console.log("🚀 [ADMIN FORCE DELETE] API CALLED");

  try {
    const { serviceId } = req.params;

    if (!serviceId) {
      return res.status(400).json({
        isSuccess: false,
        message: "serviceId is required",
      });
    }

    // ===============================
    // 1️⃣ FETCH SERVICE
    // ===============================
    const service = await Service.findById(serviceId).populate(
      "owner",
      "name email services"
    );

    if (!service) {
      return res.status(404).json({
        isSuccess: false,
        message: "Service not found",
      });
    }

    console.log("✅ Service:", service.title);
    console.log("👤 Provider:", service.owner?.name);

    // ===============================
    // 2️⃣ FETCH BOOKINGS
    // ===============================
    const bookings = await Booking.find({
      service: serviceId,
      status: { $in: ["booked", "started"] },
    });

    console.log(`📦 Bookings found: ${bookings.length}`);

    // ===============================
    // 3️⃣ HANDLE PAYMENTS & BOOKINGS
    // ===============================
    for (const booking of bookings) {
      console.log("🔁 Processing booking:", booking._id);

      // FREE BOOKING
      if (!booking.paymentId || booking.amount === 0) {
        booking.status = "cancelled";
        booking.cancelledBy = "admin";
        booking.cancelReason = "Service removed by admin";
        await booking.save();
        continue;
      }

      const payment = await Payment.findById(booking.paymentId);
      if (!payment) continue;

      const paymentIntent = await stripe.paymentIntents.retrieve(
        payment.paymentIntentId
      );

      console.log("💳 PI Status:", paymentIntent.status);

      // 🟡 HOLD PAYMENT
      if (paymentIntent.status === "requires_capture") {
        await stripe.paymentIntents.cancel(paymentIntent.id);

        payment.status = "canceled";
        payment.refundReason = "Service removed by admin";
        payment.refundedAt = new Date();
        await payment.save();
      }

      // 🟢 CAPTURED PAYMENT
      if (paymentIntent.status === "succeeded") {
        const chargeId = paymentIntent.latest_charge;

        if (chargeId) {
          const charge = await stripe.charges.retrieve(chargeId);

          const refundable =
            charge.amount - charge.amount_refunded;

          if (refundable > 0) {
            const refund = await stripe.refunds.create({
              charge: charge.id,
              amount: refundable,
              reason: "requested_by_customer",
            });

            payment.status = "refunded";
            payment.refundId = refund.id;
            payment.refundedAt = new Date();
            await payment.save();
          }
        }
      }

      booking.status = "cancelled";
      booking.cancelledBy = "admin";
      booking.cancelReason = "Service removed by admin";
      await booking.save();
    }

    // ===============================
    // 4️⃣ CLEAN DATABASE
    // ===============================
    await Booking.deleteMany({ service: serviceId });
    await Payment.deleteMany({ service: serviceId });

    await User.updateOne(
      { _id: service.owner._id },
      { $pull: { services: service._id } }
    );

    service.deleteRequestStatus = "admin_deleted";
    await service.save();

    await Service.findByIdAndDelete(serviceId);

    console.log("🔥 Service force deleted by admin");

    // ===============================
    // ✅ RESPONSE
    // ===============================
    return res.json({
      isSuccess: true,
      status: "admin_deleted",
      message:
        "Service force deleted by admin. Bookings & payments cleaned successfully ✅",
    });
  } catch (err) {
    console.error("❌ ADMIN FORCE DELETE ERROR:", err);

    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};
