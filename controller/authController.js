const bcrypt = require("bcryptjs");
const User = require("../model/User");
const { createAccessToken } = require("../utils/jwt");
const { generateOTP } = require("../utils/otp");
const { sendOtpEmail } = require("../utils/email");
const { getFullImageUrl } = require("../utils/image");
const path = require("path");
const fs = require("fs");

// ---------------- TEMP STORAGE FOR PENDING USERS ----------------
const pendingUsers = {}; // { email: { userData, otp, expiry } }

// ---------------- REGISTER ----------------
exports.register = async (req, res) => {
  try {
    const { name, email, mobile, password, register_type, uid } = req.body;

    if (!["manual", "google_auth"].includes(register_type)) {
      return res.json({ IsSucces: false, message: "Invalid register_type." });
    }

    const existing = await User.findOne({ email });
    if (existing)
      return res.json({
        IsSucces: false,
        message: "Email already registered.",
      });

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
      fs.writeFileSync(uploadPath, req.file.buffer);
    }

    // OTP generate
    const { otp, expiry } = generateOTP();

    // Store pending user in memory
    pendingUsers[email] = {
      userData: {
        uid: uid ? parseInt(uid) : null,
        name,
        email,
        mobile,
        hashed_password: hashedPassword,
        register_type,
        otp_verified: false,
        profile_image: profileImageName,
      },
      otp,
      expiry,
    };

    // Send OTP
    await sendOtpEmail(email, otp);

    res.json({ IsSucces: true, message: "OTP sent. Please verify." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (REGISTER) ----------------
exports.verifyOtpRegister = async (req, res) => {
  try {
    const { v4: uuidv4 } = await import("uuid");
    const { email, otp } = req.body;

    if (!pendingUsers[email])
      return res.json({ IsSucces: false, message: "No pending registration" });

    const tempUser = pendingUsers[email];

    if (new Date() > tempUser.expiry)
      return res.json({ IsSucces: false, message: "OTP expired" });

    if (tempUser.otp !== otp)
      return res.json({ IsSucces: false, message: "Invalid OTP" });

    // OTP correct → save user
    const newUser = new User(tempUser.userData);
    newUser.otp_verified = true;
    await newUser.save();

    // Cleanup
    delete pendingUsers[email];

    // Create session & token
    const session_id = uuidv4();
    const access_token = createAccessToken({ id: newUser._id, session_id });

    newUser.session_id = session_id;
    newUser.access_token = access_token;
    await newUser.save();

    res.json({
      IsSucces: true,
      message: "Registered successfully",
      access_token,
      session_id,
      token_type: "bearer",
      user: {
        id: newUser._id,
        uid: newUser.uid,
        name: newUser.name,
        email: newUser.email,
        mobile: newUser.mobile,
        profile_image: getFullImageUrl(newUser.profile_image),
        register_type: newUser.register_type,
        otp_verified: newUser.otp_verified,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ IsSucces: false, message: "Server error" });
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
