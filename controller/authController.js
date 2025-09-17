const bcrypt = require("bcryptjs");
const User = require("../model/User");
const PendingUser = require("../model/PendingUser");
const { createAccessToken } = require("../utils/jwt");
const { generateOTP } = require("../utils/otp");
const { sendOtpEmail } = require("../utils/email");
const { getFullImageUrl } = require("../utils/image");
const path = require("path");
const fs = require("fs");

// ---------------- TEMP STORAGE FOR PENDING USERS ----------------
exports.register = async (req, res) => {
  try {
    let { name, email, mobile, password, register_type, uid } = req.body;
    email = email.toLowerCase();

    if (!["manual", "google_auth"].includes(register_type)) {
      return res.json({ IsSucces: false, message: "Invalid register_type." });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.json({
        IsSucces: false,
        message: "Email already registered.",
      });
    }

    let hashedPassword = null;
    if (register_type === "manual" && password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Profile image save
    let profileImageName = null;
    if (req.file) {
      profileImageName = `${Date.now()}-${req.file.originalname}`;
      const uploadPath = path.join(
        __dirname,
        "../uploads/profile_images",
        profileImageName
      );
      fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
      fs.writeFileSync(uploadPath, req.file.buffer);
    }

    // Generate OTP
    const { otp, expiry } = generateOTP();

    // Save user
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

    // Send OTP email
    await sendOtpEmail(email, otp);

    return res.json({ IsSucces: true, message: "OTP sent. Please verify." });
  } catch (err) {
    console.error("❌ Register Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (REGISTER) ----------------
exports.verifyOtpRegister = async (req, res) => {
  try {
    let { email, otp } = req.body;
    email = email.toLowerCase();

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ IsSucces: false, message: "User not found" });
    }

    if (user.otp_verified) {
      return res.json({ IsSucces: false, message: "OTP already verified" });
    }

    if (new Date() > user.otp_expiry) {
      return res.json({ IsSucces: false, message: "OTP expired" });
    }

    if (user.otp_code !== String(otp)) {
      return res.json({ IsSucces: false, message: "Invalid OTP" });
    }

    // Mark user verified
    user.otp_verified = true;
    user.otp_code = null;
    user.otp_expiry = null;

    // Create session & token
    const session_id = uuidv4();
    const access_token = createAccessToken({ id: user._id, session_id });

    user.session_id = session_id;
    user.access_token = access_token;

    await user.save();

    return res.json({
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
    const { v4: uuidv4 } = await import("uuid");
    const { email, password, login_type, uid } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ IsSucces: false, message: "User not found" });

    if (login_type === "manual") {
      if (!user.hashed_password || !password)
        return res.json({ IsSucces: false, message: "Password required" });

      const valid = await bcrypt.compare(password, user.hashed_password);
      if (!valid)
        return res.json({ IsSucces: false, message: "Invalid password" });

      const { otp, expiry } = generateOTP();
      user.otp_code = otp;
      user.otp_expiry = expiry;
      user.otp_verified = false;
      await user.save();

      await sendOtpEmail(user.email, otp);
      return res.json({
        IsSucces: true,
        message: "OTP sent for login. Please verify.",
        require_otp: true,
      });
    }

    if (login_type === "google_auth") {
      if (uid) user.uid = parseInt(uid);

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

    res.json({ IsSucces: false, message: "Invalid login_type" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (LOGIN) ----------------
exports.verifyOtpLogin = async (req, res) => {
  try {
    const { v4: uuidv4 } = await import("uuid");
    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ IsSucces: false, message: "User not found" });

    if (!user.otp_code || !user.otp_expiry)
      return res.json({ IsSucces: false, message: "No OTP generated" });
    if (new Date() > user.otp_expiry)
      return res.json({ IsSucces: false, message: "OTP expired" });
    if (user.otp_code !== otp)
      return res.json({ IsSucces: false, message: "Invalid OTP" });

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
    console.error(err);
    res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};
