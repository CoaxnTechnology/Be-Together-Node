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
//---------------fake user-------------------
// controllers/adminController.js

async function getFakerForCountry(country) {
  const fakerModule = await import("@faker-js/faker");
  const { fakerEN, fakerIT, fakerES, fakerFR, fakerDE, fakerPT } = fakerModule;

  switch (country) {
    case "Italy":
      return fakerIT;
    case "Spain":
      return fakerES;
    case "France":
      return fakerFR;
    case "Germany":
      return fakerDE;
    case "Portugal":
      return fakerEN;
    default:
      return fakerEN;
  }
}
//
function generateMobileForCountry(country) {
  function randDigits(n) {
    return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join(
      ""
    );
  }

  switch (country) {
    case "India":
      // Indian mobile numbers (10 digits, starting with 6–9)
      return `${[6, 7, 8, 9][Math.floor(Math.random() * 4)]}${randDigits(9)}`;
    case "Italy":
      return `3${randDigits(9)}`;
    case "Spain":
      return `${["6", "7"][Math.floor(Math.random() * 2)]}${randDigits(8)}`;
    case "France":
      return `${["6", "7"][Math.floor(Math.random() * 2)]}${randDigits(8)}`;
    case "Germany":
      return `${["15", "16", "17"][Math.floor(Math.random() * 3)]}${randDigits(
        8
      )}`;
    case "Portugal":
      return `9${randDigits(8)}`;
    default:
      return `9${randDigits(9)}`;
  }
}
//
// Predefined Indian names
const indianFirstNames = [
  "Amit",
  "Priya",
  "Ravi",
  "Sneha",
  "Arjun",
  "Neha",
  "Kiran",
  "Pooja",
  "Rahul",
  "Anjali",
  "Vikram",
  "Meena",
  "Sanjay",
  "Divya",
  "Rohit",
  "Kavita",
];

const indianLastNames = [
  "Patel",
  "Sharma",
  "Verma",
  "Reddy",
  "Gupta",
  "Nair",
  "Khan",
  "Singh",
  "Iyer",
  "Chopra",
  "Joshi",
  "Das",
  "Yadav",
  "Bhat",
  "Mehta",
  "Pillai",
];

function cleanEmailString(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.]/g, "");
}

exports.generateFakeUsers = async (req, res) => {
  try {
    const { country = "Default", count = 10 } = req.body;
    const domain = process.env.FAKE_USER_EMAIL_DOMAIN || "mailnesia.com";

    const faker = await getFakerForCountry(country);

    const fakeUsers = Array.from({ length: count }).map(() => {
      let firstName, lastName;

      if (country === "India") {
        firstName =
          indianFirstNames[Math.floor(Math.random() * indianFirstNames.length)];
        lastName =
          indianLastNames[Math.floor(Math.random() * indianLastNames.length)];
      } else {
        firstName = faker.person.firstName();
        lastName = faker.person.lastName();
      }

      const cleanFirst = cleanEmailString(firstName);
      const cleanLast = cleanEmailString(lastName);
      const email = `${cleanFirst}.${cleanLast}.${faker.string
        .alphanumeric(4)
        .toLowerCase()}@${domain}`.toLowerCase();

      return {
        name: `${firstName} ${lastName}`,
        email,
        mobile: generateMobileForCountry(country),
        age: faker.number.int({ min: 18, max: 60 }),
        register_type: "manual",
        login_type: "manual",
        status: "active",
        is_active: true,
        is_fake: true,
      };
    });

    const created = await User.insertMany(fakeUsers);

    res.json({
      success: true,
      createdCount: created.length,
      created: created.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        mobile: u.mobile,
      })),
    });
  } catch (err) {
    console.error("generateFakeUsers error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

//--------------------Generate Users from CSV-------------------
//const csv = require("csv-parser");
const { Readable } = require("stream");

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

            const services = JSON.parse(row.services || "[]");
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

        res.json({
          success: true,
          message: "CSV processed ✅",
          createdCount: createdUsers.length,
          skippedCount: skippedUsers.length,
          createdUsers,
          skippedUsers,
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
//const User = require("../models/User");
//const Service = require("../models/Service");

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

// Simple date/time validators
function isValidTime(t) {
  return typeof t === "string" && /^\d{2}:\d{2}(\s?(AM|PM))?$/i.test(t);
}

function isValidDateISO(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// Helper to format time to AM/PM
function formatTimeToAMPM(timeStr) {
  if (!timeStr) return null;
  const m = moment(timeStr, ["HH:mm", "hh:mm A"], true);
  if (!m.isValid()) return null;
  return m.format("hh:mm A");
}

// Create service API
exports.createService = async (req, res) => {
  try {
    console.log("===== createService called =====");

    const userId = req.body.userId || (req.user && req.user.id);
    if (!userId)
      return res
        .status(400)
        .json({ isSuccess: false, message: "userId is required" });

    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ isSuccess: false, message: "User not found" });
    if (!user.is_active)
      return res
        .status(403)
        .json({ isSuccess: false, message: "User is not active" });

    const body = req.body;
    const title = body.title && String(body.title).trim();
    const description = body.description || "";
    const language = body.language || body.Language || "English";
    const isFree = body.isFree === true || body.isFree === "true";
    const price = isFree ? 0 : Number(body.price || 0);

    const location = tryParse(body.location);
    const city = body.city;
    const isDoorstepService =
      body.isDoorstepService === true || body.isDoorstepService === "true"; // ✅ new field
    const service_type = body.service_type || "one_time";
    const date = body.date;
    const start_time = body.start_time;
    const end_time = body.end_time;
    const max_participants = Number(body.max_participants || 1);
    const categoryId = body.categoryId;
    const selectedTags = tryParse(body.selectedTags) || [];

    // ---- Validation ----
    if (!title)
      return res
        .status(400)
        .json({ isSuccess: false, message: "Title is required" });

    if (
      !location ||
      !location.name ||
      location.latitude == null ||
      location.longitude == null
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: "Location (name, latitude, longitude) is required",
      });
    }

    if (!city)
      return res
        .status(400)
        .json({ isSuccess: false, message: "City is required" });

    if (!categoryId)
      return res
        .status(400)
        .json({ isSuccess: false, message: "categoryId is required" });

    const category = await Category.findById(categoryId);
    if (!category)
      return res
        .status(404)
        .json({ isSuccess: false, message: "Category not found" });

    if (!Array.isArray(selectedTags) || !selectedTags.length) {
      return res.status(400).json({
        isSuccess: false,
        message: "selectedTags must be a non-empty array",
      });
    }

    const validTags = category.tags.filter((tag) =>
      selectedTags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    );
    if (!validTags.length)
      return res.status(400).json({
        isSuccess: false,
        message: "No valid tags selected from this category",
      });

    // ---- Build payload ----
    const servicePayload = {
      title,
      description,
      Language: language,
      isFree,
      price,
      location_name: location.name,
      city,
      isDoorstepService, // ✅ save new field
      location: {
        type: "Point",
        coordinates: [Number(location.longitude), Number(location.latitude)],
      },
      category: category._id,
      tags: validTags,
      max_participants,
      service_type,
      owner: user._id,
    };

    // One-time service
    if (service_type === "one_time") {
      const formattedStart = formatTimeToAMPM(start_time);
      const formattedEnd = formatTimeToAMPM(end_time);

      if (!formattedStart || !formattedEnd) {
        return res.status(400).json({
          isSuccess: false,
          message:
            "Invalid start_time or end_time (must be HH:mm or hh:mm AM/PM)",
        });
      }

      if (!isValidDateISO(date)) {
        return res.status(400).json({
          isSuccess: false,
          message: "Valid date (YYYY-MM-DD) required for one_time",
        });
      }

      servicePayload.date = date;
      servicePayload.start_time = formattedStart;
      servicePayload.end_time = formattedEnd;
    }

    // Recurring service
    if (service_type === "recurring") {
      const recurring_schedule = tryParse(body.recurring_schedule) || [];
      if (!Array.isArray(recurring_schedule) || !recurring_schedule.length) {
        return res.status(400).json({
          isSuccess: false,
          message: "Recurring schedule is required for recurring services",
        });
      }

      servicePayload.recurring_schedule = recurring_schedule.map((item) => {
        const formattedStart = formatTimeToAMPM(item.start_time);
        const formattedEnd = formatTimeToAMPM(item.end_time);

        if (
          !item.day ||
          !isValidDateISO(item.date) ||
          !formattedStart ||
          !formattedEnd
        ) {
          throw new Error(
            "Each recurring schedule item must include day, date, start_time, end_time in HH:mm or hh:mm AM/PM format"
          );
        }

        return {
          day: item.day,
          date: item.date,
          start_time: formattedStart,
          end_time: formattedEnd,
        };
      });
    }

    // ---- Save service ----
    const createdService = new Service(servicePayload);
    await createdService.save();

    // Link service to user
    user.services.push(createdService._id);
    await user.save();

    console.log("Service created successfully:", createdService._id);

    return res.json({
      isSuccess: true,
      message: "Service created successfully",
      data: createdService,
    });
  } catch (err) {
    console.error("createService error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, message: "Server error", error: err.message });
  }
};

const JWT_SECRET = "YOUR_SECRET_KEY"; // replace with env variable in production

// Admin Login
exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res
      .status(400)
      .json({ success: false, error: "Email and password required" });

  try {
    const admin = await Admin.findOne({ email });
    if (!admin)
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });

    if (!admin.is_active)
      return res
        .status(403)
        .json({ success: false, error: "Admin account inactive" });

    const isMatch = await bcrypt.compare(password, admin.hashed_password);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });

    // Generate JWT Token
    const token = jwt.sign({ id: admin._id, email: admin.email }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      success: true,
      message: "Login successful",
      admin: { id: admin._id, name: admin.name, email: admin.email },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
