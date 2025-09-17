// controller/authController.js
const bcrypt = require("bcryptjs");
const User = require("../model/User");
const { createAccessToken } = require("../utils/jwt");
const { generateOTP } = require("../utils/otp");
const { sendOtpEmail } = require("../utils/email");
const { getFullImageUrl } = require("../utils/image");
const { randomUUID } = require("crypto");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const multer = require("multer"); // kept for MulterError checks

// configure cloudinary (env vars must be set)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// helper: upload buffer to Cloudinary
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

// ---------------- REGISTER ----------------
exports.register = async (req, res) => {
  let uploadedPublicId = null; // for cleanup if needed
  try {
    let { name, email, mobile, password, register_type, uid } = req.body;
    if (email) email = String(email).toLowerCase();

    // validate register_type
    if (!["manual", "google_auth"].includes(register_type)) {
      return res.status(400).json({ IsSucces: false, message: "Invalid register_type." });
    }

    // basic required fields
    if (!email) {
      return res.status(400).json({ IsSucces: false, message: "Email required." });
    }

    // check existing user BEFORE heavy work
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ IsSucces: false, message: "Email already registered." });
    }

    // hash password when manual registration
    let hashedPassword = null;
    if (register_type === "manual") {
      if (!password) {
        return res.status(400).json({ IsSucces: false, message: "Password required for manual registration." });
      }
      hashedPassword = await bcrypt.hash(String(password), 10);
    }

    // Determine profile image URL:
    // Priority:
    // 1) If client sent `profile_image` (string URL) in body (Flutter direct upload flow), use it.
    // 2) Else if req.file with buffer exists (server upload flow), upload to Cloudinary and use returned secure_url.
    let profileImageUrl = null;

    // 1) check client-provided URL
    if (req.body && req.body.profile_image) {
      // Basic validation: must be a non-empty string. (You may add stronger validation if needed.)
      profileImageUrl = String(req.body.profile_image).trim() || null;
    } else if (req.file && req.file.buffer) {
      // 2) server-side upload to Cloudinary
      try {
        const publicId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = await uploadBufferToCloudinary(req.file.buffer, "profile_images", publicId);
        uploadedPublicId = result.public_id;
        profileImageUrl = result.secure_url || null;
      } catch (uploadErr) {
        console.error("Cloudinary upload failed (non-fatal):", uploadErr);
        // Do not block registration; leave profileImageUrl as null and proceed
      }
    }

    // Generate OTP
    const { otp, expiry } = generateOTP();

    // Create user document (store profile image URL as a string)
    const newUser = new User({
      uid: uid ? String(uid) : null,
      name: name ? String(name) : null,
      email,
      mobile: mobile ? String(mobile) : null,
      hashed_password: hashedPassword,
      register_type,
      otp_verified: false,
      otp_code: otp,
      otp_expiry: expiry,
      profile_image: profileImageUrl, // string URL or null
    });

    await newUser.save();

    // Send OTP email (best-effort)
    try {
      await sendOtpEmail(email, otp);
    } catch (emailErr) {
      console.error("Failed to send OTP email (non-fatal):", emailErr);
    }

    return res.status(201).json({ IsSucces: true, message: "OTP sent. Please verify." });
  } catch (err) {
    console.error("❌ Register Error:", err);

    // If multer threw, handle gracefully
    if (err instanceof multer.MulterError) {
      // if we uploaded to Cloudinary but DB save failed, attempt cleanup
      if (uploadedPublicId) {
        try { await cloudinary.uploader.destroy(uploadedPublicId, { resource_type: "image" }); } catch (e) { console.error("cleanup failed", e); }
      }
      return res.status(400).json({ IsSucces: false, message: err.message });
    }

    // if cloudinary uploaded but DB save failed, attempt to delete the uploaded image
    if (uploadedPublicId) {
      try { await cloudinary.uploader.destroy(uploadedPublicId, { resource_type: "image" }); } catch (e) { console.error("cleanup failed", e); }
    }

    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (REGISTER) ----------------
exports.verifyOtpRegister = async (req, res) => {
  try {
    let { email, otp } = req.body;
    if (!email) return res.status(400).json({ IsSucces: false, message: "Email required" });
    if (!otp) return res.status(400).json({ IsSucces: false, message: "OTP required" });

    email = String(email).toLowerCase();
    otp = String(otp);

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ IsSucces: false, message: "User not found" });

    if (!user.otp_code || !user.otp_expiry) {
      return res.status(400).json({ IsSucces: false, message: "No OTP generated" });
    }

    if (Date.now() > new Date(user.otp_expiry).getTime()) {
      return res.status(400).json({ IsSucces: false, message: "OTP expired" });
    }

    if (String(user.otp_code) !== otp) {
      return res.status(400).json({ IsSucces: false, message: "Invalid OTP" });
    }

    // OTP correct → update user
    user.otp_verified = true;
    user.otp_code = null;
    user.otp_expiry = null;

    const session_id = randomUUID();
    const access_token = createAccessToken({ id: user._id, session_id });

    user.session_id = session_id;
    user.access_token = access_token;

    await user.save();

    res.json({
      IsSucces: true,
      message: "Registered successfully",
      access_token,
      session_id,
      token_type: "bearer",
      user: {
        id: user._id,
        uid: user.uid,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        profile_image: getFullImageUrl(user.profile_image), // returns string or null
        register_type: user.register_type,
        otp_verified: user.otp_verified,
      },
    });
  } catch (err) {
    console.error("❌ Verify OTP Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- LOGIN ----------------
exports.login = async (req, res) => {
  try {
    const { email, password, login_type, uid } = req.body;
    if (!email) return res.status(400).json({ IsSucces: false, message: "Email required" });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return res.status(404).json({ IsSucces: false, message: "User not found" });

    if (login_type === "manual") {
      if (!user.hashed_password || !password)
        return res.status(400).json({ IsSucces: false, message: "Password required" });

      const valid = await bcrypt.compare(String(password), user.hashed_password);
      if (!valid) return res.status(401).json({ IsSucces: false, message: "Invalid password" });

      const { otp, expiry } = generateOTP();
      user.otp_code = otp;
      user.otp_expiry = expiry;
      user.otp_verified = false;
      await user.save();

      try {
        await sendOtpEmail(user.email, otp);
      } catch (emailErr) {
        console.error("Failed to send login OTP email (non-fatal):", emailErr);
      }

      return res.json({
        IsSucces: true,
        message: "OTP sent for login. Please verify.",
        require_otp: true,
      });
    }

    if (login_type === "google_auth") {
      if (uid) user.uid = String(uid);

      const session_id = randomUUID();
      const access_token = createAccessToken({ id: user._id, session_id });

      user.session_id = session_id;
      user.access_token = access_token;
      user.otp_verified = true;
      await user.save();

      return res.json({
        IsSucces: true,
        message: "Login successful",
        access_token,
        session_id,
        token_type: "bearer",
        user: {
          id: user._id,
          uid: user.uid,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          profile_image: getFullImageUrl(user.profile_image),
          register_type: user.register_type,
          otp_verified: user.otp_verified,
        },
      });
    }

    return res.status(400).json({ IsSucces: false, message: "Invalid login_type" });
  } catch (err) {
    console.error("❌ Login Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (LOGIN) ----------------
exports.verifyOtpLogin = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email) return res.status(400).json({ IsSucces: false, message: "Email required" });
    if (!otp) return res.status(400).json({ IsSucces: false, message: "OTP required" });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return res.status(404).json({ IsSucces: false, message: "User not found" });

    if (!user.otp_code || !user.otp_expiry)
      return res.status(400).json({ IsSucces: false, message: "No OTP generated" });

    if (Date.now() > new Date(user.otp_expiry).getTime())
      return res.status(400).json({ IsSucces: false, message: "OTP expired" });

    if (String(user.otp_code) !== String(otp))
      return res.status(400).json({ IsSucces: false, message: "Invalid OTP" });

    user.otp_verified = true;
    user.otp_code = null;
    user.otp_expiry = null;

    const session_id = randomUUID();
    const access_token = createAccessToken({ id: user._id, session_id });

    user.session_id = session_id;
    user.access_token = access_token;
    await user.save();

    res.json({
      IsSucces: true,
      message: "Success",
      access_token,
      token_type: "bearer",
      user: {
        id: user._id,
        uid: user.uid,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        profile_image: getFullImageUrl(user.profile_image),
        register_type: user.register_type,
        otp_verified: user.otp_verified,
      },
    });
  } catch (err) {
    console.error("❌ Verify OTP (login) Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};
