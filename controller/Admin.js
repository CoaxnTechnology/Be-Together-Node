const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
const axios = require("axios");
const Category = require("../model/Category");
const User = require("../model/User");
const Service = require("../model/Service");
const { getFullImageUrl } = require("../utils/image");
require("dotenv").config();
// Helper to upload buffer to Cloudinary

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
        console.error(
          "HrFlow tagging error:",
          err.response?.data || err.message
        );
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
// ---------------------------------GET ALL CATEGORY With Pagination-------------------------------
// controller/Admin.js (or wherever your function is)

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
    const formattedCategories = categories.map(cat => ({
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
      return fakerPT;
    default:
      return fakerEN;
  }
}

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

    await User.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: "Fake user deleted successfully",
    });
  } catch (err) {
    console.error(err);
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
