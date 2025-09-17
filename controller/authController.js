// controller/authController.js
const bcrypt = require("bcryptjs");
const User = require("../model/User");
const { createAccessToken } = require("../utils/jwt");
const { generateOTP } = require("../utils/otp");
const { sendOtpEmail } = require("../utils/email");
const { getFullImageUrl } = require("../utils/image");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
 // use require for consistency

// helper: remove uploaded file from disk (silent on error)
function removeUploadedFile(filename) {
  if (!filename) return;
  const filePath = path.join(__dirname, "../uploads/profile_images", filename);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("Failed to remove file:", filePath, err);
    }
  });
}

// ---------------- REGISTER ----------------
exports.register = async (req, res) => {
  try {
    let { name, email, mobile, password, register_type, uid } = req.body;

    if (email) email = String(email).toLowerCase();

    // validate register_type
    if (!["manual", "google_auth"].includes(register_type)) {
      // if user uploaded a file, remove it since registration won't continue
      if (req.file) removeUploadedFile(req.file.filename);
      return res.status(400).json({ IsSucces: false, message: "Invalid register_type." });
    }

    // basic required fields
    if (!email) {
      if (req.file) removeUploadedFile(req.file.filename);
      return res.status(400).json({ IsSucces: false, message: "Email required." });
    }

    // check existing user BEFORE heavy work
    const existing = await User.findOne({ email });
    if (existing) {
      if (req.file) removeUploadedFile(req.file.filename);
      return res.status(409).json({ IsSucces: false, message: "Email already registered." });
    }

    // hash password when manual registration
    let hashedPassword = null;
    if (register_type === "manual") {
      if (!password) {
        if (req.file) removeUploadedFile(req.file.filename);
        return res.status(400).json({ IsSucces: false, message: "Password required for manual registration." });
      }
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Profile image: optional
    let profileImageName = null;
    if (req.file) {
      // multer uploaded file: req.file.filename is safe to store
      profileImageName = req.file.filename;
    }

    // Generate OTP
    const { otp, expiry } = generateOTP();

    // Create user document
    const newUser = new User({
      uid: uid ? String(uid) : null,
      name,
      email,
      mobile,
      hashed_password: hashedPassword,
      register_type,
      otp_verified: false,
      otp_code: otp,
      otp_expiry: expiry,
      profile_image: profileImageName,
    });

    await newUser.save();

    // Fire OTP email (don't await fatal on send failure if you want resiliency)
    try {
      await sendOtpEmail(email, otp);
    } catch (emailErr) {
      console.error("Failed to send OTP email:", emailErr);
      // optionally inform client but keep registration; up to you
    }

    return res.status(201).json({ IsSucces: true, message: "OTP sent. Please verify." });
  } catch (err) {
    console.error("❌ Register Error:", err);

    // If multer threw, it will be a MulterError
    if (err instanceof multer.MulterError) {
      // remove uploaded file if present
      if (req.file) removeUploadedFile(req.file.filename);
      return res.status(400).json({ IsSucces: false, message: err.message });
    }

    // generic fallback
    if (req.file) removeUploadedFile(req.file.filename);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (REGISTER) ----------------
exports.verifyOtpRegister = async (req, res) => {
  const { v4: uuidv4 } = require("uuid");
  try {
    let { email, otp } = req.body;
    if (!email) return res.status(400).json({ IsSucces: false, message: "Email required" });
    if (!otp) return res.status(400).json({ IsSucces: false, message: "OTP required" });

    email = String(email).toLowerCase();
    otp = String(otp);

    console.log("📩 Verify OTP Request:", { email, otp });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ IsSucces: false, message: "User not found" });

    if (!user.otp_code || !user.otp_expiry) {
      return res.status(400).json({ IsSucces: false, message: "No OTP generated" });
    }

    // secure expiry check
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

    const session_id = uuidv4();
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
        profile_image: getFullImageUrl(user.profile_image),
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
        console.error("Failed to send login OTP email:", emailErr);
      }

      return res.json({
        IsSucces: true,
        message: "OTP sent for login. Please verify.",
        require_otp: true,
      });
    }

    if (login_type === "google_auth") {
      if (uid) user.uid = String(uid);

      const session_id = uuidv4();
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

    const session_id = uuidv4();
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
