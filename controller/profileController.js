const User = require("../model/User");
const Category = require("../model/Category");
const { getFullImageUrl } = require("../utils/image");

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

// ---------------- UPDATE Profile ----------------
exports.editProfile = async (req, res) => {
  try {
    const {
      email,
      name,
      bio,
      languages = [],
      interests = [],
      availability = [], // new field from frontend
    } = req.body;

    // Identify user
    let user = email
      ? await User.findOne({ email })
      : await User.findById(req.user.id);

    if (!user) {
      return res.json({
        isSuccess: false,
        message: "User not found",
        data: null,
      });
    }

    // --- Update basic fields ---
    if (name && name.trim() === "") {
      return res.json({
        isSuccess: false,
        message: "Name cannot be empty",
        data: null,
      });
    }
    if (name) user.name = name.trim();
    if (bio) user.bio = bio.trim();

    // Profile image upload
    if (req.file) {
      user.profile_image = `/static/profile_images/${req.file.filename}`;
    }

    // Languages - store directly from frontend strings
    if (languages.length > 0) {
      user.languages = languages; // string array
    }

    // Interests - match with Category.tags
    if (interests.length > 0) {
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
    if (availability.length > 0) {
      // Example format from frontend:
      // [
      //   { day: "Monday", times: [{ start_time: "09:00", end_time: "12:00" }, { start_time: "14:00", end_time: "18:00" }] },
      //   { day: "Tuesday", times: [{ start_time: "10:00", end_time: "16:00" }] }
      // ]
      user.availability = availability;
    }

    await user.save();
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
        languages: user.languages,
        interests: user.interests,
        availability: user.availability, // included in response
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
