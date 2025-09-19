// controller/authController.js (UPDATED)
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../model/User");
const { createAccessToken } = require("../utils/jwt");
const { generateOTP } = require("../utils/otp");
const { sendOtpEmail } = require("../utils/email");
const { getFullImageUrl } = require("../utils/image");
const { randomUUID } = require("crypto");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const multer = require("multer"); // for MulterError checks

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
    const opts = {
      folder,
      resource_type: "image",
      overwrite: false,
      use_filename: false,
    };
    if (publicId) opts.public_id = publicId;

    const uploadStream = cloudinary.uploader.upload_stream(
      opts,
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// ---------------- REGISTER ----------------
exports.register = async (req, res) => {
  let uploadedPublicId = null;
  try {
    let {
      name,
      email,
      mobile,
      password,
      register_type,
      provider_id,
      provider_uid,
    } = req.body;
    // DEBUG: add at very top of exports.register (dev only)
    console.log("--- REGISTER HIT ---");
    console.log("headers:", req.headers ? Object.keys(req.headers) : {});
    console.log("body (keys):", req.body ? Object.keys(req.body) : {});
    console.log("body:", req.body);
    console.log("file present:", !!req.file);
    if (req.file) {
      console.log("file keys:", Object.keys(req.file));
      console.log("file size:", req.file.size);
    }

    if (email) email = String(email).toLowerCase();

    if (!["manual", "google_auth"].includes(register_type)) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Invalid register_type." });
    }

    if (!email) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required." });
    }

    // check existing user BEFORE heavy work
    const existing = await User.findOne({ email });

    // If user exists and was created via google_auth, and current flow is google_auth -> treat as login
    if (existing && register_type === "google_auth") {
      // If existing was created manually, reject to avoid potential clash
      if (existing.register_type && existing.register_type === "manual") {
        return res.status(409).json({
          IsSucces: false,
          message: "Email already registered with manual method.",
        });
      }

      // existing is google_auth (or not set) -> create session and return tokens (idempotent)
      const session_id = randomUUID();
      const access_token = createAccessToken({ id: existing._id, session_id });

      existing.session_id = session_id;
      existing.access_token = access_token;
      existing.otp_verified = true;
      // if provider info provided, update it
      if (provider_id) existing.provider_id = provider_id;
      if (provider_uid) existing.provider_uid = provider_uid;
      await existing.save();

      return res.status(200).json({
        IsSucces: true,
        message: "Login (existing google account).",
        access_token,
        session_id,
        token_type: "bearer",
        user: {
          id: existing._id,
          name: existing.name,
          email: existing.email,
          mobile: existing.mobile,
          profile_image: getFullImageUrl(existing.profile_image),
          register_type: existing.register_type,
          otp_verified: existing.otp_verified,
        },
      });
    }

    // If existing and trying to register manually -> error
    if (existing && register_type === "manual") {
      return res
        .status(409)
        .json({ IsSucces: false, message: "Email already registered." });
    }

    // Prepare fields based on registration type
    let hashedPassword = null;
    let otp = null;
    let expiry = null;
    let otp_verified = false;

    if (register_type === "manual") {
      if (!password) {
        return res.status(400).json({
          IsSucces: false,
          message: "Password required for manual registration.",
        });
      }
      hashedPassword = await bcrypt.hash(String(password), 10);
      const otpObj = generateOTP();
      otp = otpObj.otp;
      expiry = otpObj.expiry;
      otp_verified = false;
    } else if (register_type === "google_auth") {
      // Accept missing password & mobile from firebase
      hashedPassword = null;
      otp = null;
      expiry = null;
      otp_verified = true;
      // (OPTIONAL) You could verify an incoming Google ID token here
    }

    // Handle profile image:
    let profileImageUrl = null;
    if (req.body && req.body.profile_image) {
      // client provided an image URL (common with Firebase)
      profileImageUrl = String(req.body.profile_image).trim() || null;
    } else if (req.file && req.file.buffer) {
      // server-side upload flow
      try {
        const publicId = `user_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const result = await uploadBufferToCloudinary(
          req.file.buffer,
          "profile_images",
          publicId
        );
        uploadedPublicId = result.public_id;
        profileImageUrl = result.secure_url || null;
      } catch (uploadErr) {
        console.error("Cloudinary upload failed (non-fatal):", uploadErr);
        // Proceed without profile image
      }
    }

    // Create new user
    const newUser = new User({
      _id: new mongoose.Types.ObjectId(),
      name: name ? String(name) : null,
      email,
      mobile: mobile ? String(mobile) : null,
      hashed_password: hashedPassword ? String(hashedPassword) : null,
      register_type,
      otp_verified,
      otp_code: otp,
      otp_expiry: expiry,
      profile_image: profileImageUrl,
      provider_id: provider_id || null,
      provider_uid: provider_uid || null,
    });

    await newUser.save();

    if (register_type === "manual") {
      // send OTP best-effort
      try {
        await sendOtpEmail(email, otp);
      } catch (emailErr) {
        console.error("Failed to send OTP email (non-fatal):", emailErr);
      }
      return res
        .status(201)
        .json({ IsSucces: true, message: "OTP sent. Please verify." });
    }

    // google_auth: create session and return tokens
    if (register_type === "google_auth") {
      const session_id = randomUUID();
      const access_token = createAccessToken({ id: newUser._id, session_id });

      newUser.session_id = session_id;
      newUser.access_token = access_token;
      await newUser.save();

      return res.status(201).json({
        IsSucces: true,
        message: "Registered successfully",
        access_token,
        session_id,
        token_type: "bearer",
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          mobile: newUser.mobile,
          profile_image: getFullImageUrl(newUser.profile_image),
          register_type: newUser.register_type,
          otp_verified: newUser.otp_verified,
        },
      });
    }

    return res.status(500).json({ IsSucces: false, message: "Server error" });
  } catch (err) {
    console.error("❌ Register Error:", err);

    if (err instanceof multer.MulterError) {
      // cleanup cloudinary if needed
      if (uploadedPublicId) {
        try {
          await cloudinary.uploader.destroy(uploadedPublicId, {
            resource_type: "image",
          });
        } catch (e) {
          console.error("cleanup failed", e);
        }
      }
      return res.status(400).json({ IsSucces: false, message: err.message });
    }

    if (uploadedPublicId) {
      try {
        await cloudinary.uploader.destroy(uploadedPublicId, {
          resource_type: "image",
        });
      } catch (e) {
        console.error("cleanup failed", e);
      }
    }

    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (REGISTER) ----------------
exports.verifyOtpRegister = async (req, res) => {
  try {
    let { email, otp } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });
    }
    if (!otp) {
      return res.status(400).json({ IsSucces: false, message: "OTP required" });
    }

    email = String(email).toLowerCase();
    otp = String(otp);

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });
    }

    if (!user.otp_code || !user.otp_expiry) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "No OTP generated" });
    }

    // Debug logs
    console.log("Now:", new Date());
    console.log("From DB:", user.otp_expiry, typeof user.otp_expiry);
    console.log("getTime:", new Date(user.otp_expiry).getTime());

    // Expiry check
    if (Date.now() > new Date(user.otp_expiry).getTime()) {
      return res.status(400).json({ IsSucces: false, message: "OTP expired" });
    }

    // OTP match check
    if (String(user.otp_code) !== otp) {
      return res.status(400).json({ IsSucces: false, message: "Invalid OTP" });
    }

    // Mark verified
    user.otp_verified = true;
    user.otp_code = null;
    user.otp_expiry = null;

    const session_id = randomUUID();
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
    const { email, password, login_type, provider_id, provider_uid } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user)
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });

    if (login_type === "manual") {
      if (!user.hashed_password || !password)
        return res
          .status(400)
          .json({ IsSucces: false, message: "Password required" });

      const valid = await bcrypt.compare(
        String(password),
        user.hashed_password
      );
      if (!valid)
        return res
          .status(401)
          .json({ IsSucces: false, message: "Invalid password" });

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
      // If user exists but was manual -> reject to avoid takeover
      if (user.register_type && user.register_type === "manual") {
        return res.status(409).json({
          IsSucces: false,
          message: "Account exists with manual registration. Use manual login.",
        });
      }

      // Accept google_auth login: create session and return tokens
      const session_id = randomUUID();
      const access_token = createAccessToken({ id: user._id, session_id });

      user.session_id = session_id;
      user.access_token = access_token;
      user.otp_verified = true;
      if (provider_id) user.provider_id = provider_id;
      if (provider_uid) user.provider_uid = provider_uid;
      await user.save();

      return res.json({
        IsSucces: true,
        message: "Login successful",
        access_token,
        session_id,
        token_type: "bearer",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          profile_image: getFullImageUrl(user.profile_image),
          register_type: user.register_type,
          otp_verified: user.otp_verified,
        },
      });
    }

    return res
      .status(400)
      .json({ IsSucces: false, message: "Invalid login_type" });
  } catch (err) {
    console.error("❌ Login Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};

// ---------------- VERIFY OTP (LOGIN) ----------------
exports.verifyOtpLogin = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });
    if (!otp)
      return res.status(400).json({ IsSucces: false, message: "OTP required" });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user)
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });

    if (!user.otp_code || !user.otp_expiry)
      return res
        .status(400)
        .json({ IsSucces: false, message: "No OTP generated" });

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
      session_id,
      token_type: "bearer",
      user: {
        id: user._id,
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
// ---------------- RESEND OTP ----------------
/**
 * POST /auth/resend-otp
 * body: { email: string, purpose?: "register" | "login" }
 *
 * Behavior:
 * - ALWAYS generates a new OTP and expiry on every call (so previous OTPs are invalid immediately)
 * - Updates otp_attempt_version (optional bookkeeping)
 * - Enforces a resend cooldown
 */
exports.resendOtp = async (req, res) => {
  try {
    const { email, purpose = "register" } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });
    }

    const lowerEmail = String(email).toLowerCase();
    const user = await User.findOne({ email: lowerEmail });

    if (!user) {
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });
    }

    // Only manual accounts use OTP flows
    if (user.register_type === "google_auth" || user.is_google_auth) {
      return res.status(400).json({
        IsSucces: false,
        message: "OTP not required for Google accounts",
      });
    }

    // Purpose checks
    if (purpose === "register") {
      if (user.otp_verified) {
        return res.status(400).json({
          IsSucces: false,
          message: "Account already verified",
        });
      }
    } else if (purpose === "login") {
      if (!user.hashed_password) {
        return res.status(400).json({
          IsSucces: false,
          message: "Login OTP not available for this account",
        });
      }
    } else {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Invalid purpose" });
    }

    // Cooldown protection
    const RESEND_COOLDOWN_SECONDS = 60; // tweak as needed
    if (user.lastResendAt) {
      const elapsed = Date.now() - new Date(user.lastResendAt).getTime();
      const elapsedSec = Math.floor(elapsed / 1000);
      if (elapsedSec < RESEND_COOLDOWN_SECONDS) {
        const wait = RESEND_COOLDOWN_SECONDS - elapsedSec;
        return res.status(429).json({
          IsSucces: false,
          message: `Please wait ${wait} seconds before requesting a new OTP.`,
        });
      }
    }

    // ALWAYS generate a new OTP -> this overwrites previous OTP and invalidates it immediately
    const { otp, expiry } = generateOTP();

    // Optional bookkeeping: version for OTP attempts (useful for logs or analytics)
    if (typeof user.otp_attempt_version === "undefined" || user.otp_attempt_version === null) {
      user.otp_attempt_version = 1;
    } else {
      user.otp_attempt_version = Number(user.otp_attempt_version) + 1;
    }

    // Overwrite OTP fields (immediately invalidates old OTP)
    user.otp_code = String(otp);
    user.otp_expiry = expiry;
    user.otp_verified = false;
    user.lastResendAt = new Date();

    await user.save();

    // Send email (best-effort)
    try {
      await sendOtpEmail(user.email, otp);
    } catch (emailErr) {
      console.error("Failed to send OTP email (non-fatal):", emailErr);
      // Don't fail the request -- OTP is stored in DB regardless.
    }

    return res.json({
      IsSucces: true,
      message: "A new OTP has been generated and sent to your email.",
      require_otp: true,
      // note: DO NOT include the otp in responses in production
    });
  } catch (err) {
    console.error("❌ Resend OTP Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};
