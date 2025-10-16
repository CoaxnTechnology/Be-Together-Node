// controller/authController.js (UPDATED)
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../model/User");
const { createAccessToken } = require("../utils/jwt");
const { generateOTP } = require("../utils/otp");
const { sendOtpEmail, sendResetEmail } = require("../utils/email");
const { getFullImageUrl } = require("../utils/image");
const { randomUUID } = require("crypto");
const crypto = require("crypto");
const { createResetToken } = require("../utils/token");
//const { sendResetEmail, sendOtpEmail } = require("../utils/email");
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
      fcmToken,
    } = req.body;

    console.log("--- REGISTER HIT ---");
    console.log("body:", req.body);
    console.log("file present:", !!req.file);

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

    const existing = await User.findOne({ email });

    // If existing google_auth user, treat as login
    if (existing && register_type === "google_auth") {
      if (existing.register_type === "manual") {
        return res.status(409).json({
          IsSucces: false,
          message: "Email already registered with manual method.",
        });
      }

      const session_id = randomUUID();
      const access_token = createAccessToken({ id: existing._id, session_id });

      existing.session_id = session_id;
      existing.access_token = access_token;
      existing.otp_verified = true;

      if (provider_id) existing.provider_id = provider_id;
      if (provider_uid) existing.provider_uid = provider_uid;
      if (fcmToken) await existing.addFcmToken(fcmToken); // ✅ safe FCM handling

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
          fcmToken: existing.fcmTokens, // updated array
        },
      });
    }

    // Manual registration conflict
    if (existing && register_type === "manual") {
      return res
        .status(409)
        .json({ IsSucces: false, message: "Email already registered." });
    }

    // Password and OTP setup for manual registration
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
    } else {
      otp_verified = true; // google_auth
    }

    // Handle profile image
    let profileImageUrl = null;
    if (req.body.profile_image) {
      profileImageUrl = String(req.body.profile_image).trim() || null;
    } else if (req.file && req.file.buffer) {
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
      fcmTokens: [], // always an array
    });

    if (fcmToken) await newUser.addFcmToken(fcmToken); // ✅ safe addition

    await newUser.save();

    if (register_type === "manual") {
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
          fcmToken: newUser.fcmTokens,
        },
      });
    }

    return res.status(500).json({ IsSucces: false, message: "Server error" });
  } catch (err) {
    console.error("❌ Register Error:", err);

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
    // 🔹 Safety: fallback to empty object if req.body is undefined
    const body = req.body || {};
    console.log("📥 Login request body:", body);

    const {
      email,
      password,
      login_type,
      provider_id,
      provider_uid,
      fcmToken,
      name,
      profile_image,
    } = body;

    if (!email) {
      console.log("❌ Email missing in request");
      return res.status(400).json({ IsSucces: false, message: "Email required" });
    }

    const emailLower = String(email).toLowerCase();
    let user = await User.findOne({ email: emailLower });
    console.log("🔍 Fetched user from DB:", user);

    // -------------------- MANUAL LOGIN -----------------------
    if (login_type === "manual") {
      console.log("💻 Attempting manual login");

      if (!user) {
        console.log("❌ Manual login failed: user not found");
        return res.status(404).json({ IsSucces: false, message: "User not found" });
      }

      if (!user.hashed_password || !password) {
        console.log("❌ Password missing for manual login");
        return res.status(400).json({ IsSucces: false, message: "Password required" });
      }

      const valid = await bcrypt.compare(String(password), user.hashed_password);
      console.log("🔑 Password valid?", valid);

      if (!valid) {
        console.log("❌ Manual login failed: invalid password");
        return res.status(401).json({ IsSucces: false, message: "Invalid password" });
      }

      // ✅ Manual login ignores name/profile_image

      const { otp, expiry } = generateOTP();
      user.otp_code = otp;
      user.otp_expiry = expiry;
      user.otp_verified = false;

      if (fcmToken) {
        console.log("📲 Adding FCM token:", fcmToken);
        await user.addFcmToken(fcmToken);
      }

      await user.save();
      console.log("✅ Manual login OTP saved:", otp);

      try {
        await sendOtpEmail(user.email, otp);
        console.log("✉️ OTP email sent");
      } catch (emailErr) {
        console.error("⚠️ Failed to send OTP email (non-fatal):", emailErr);
      }

      return res.json({
        IsSucces: true,
        message: "OTP sent for login. Please verify.",
        require_otp: true,
        fcmToken: user.fcmTokens,
      });
    }

    // -------------------- GOOGLE LOGIN --------------------
    if (login_type === "google_auth") {
      console.log("🌐 Attempting Google login");

      const userName = name?.trim() || "No Name";
      const userProfileImage = profile_image?.trim() || null;

      if (!user) {
        console.log("🆕 User not found, creating new Google user");

        user = new User({
          email: emailLower,
          name: userName,
          register_type: "google_auth",
          provider_id: provider_id || null,
          provider_uid: provider_uid || null,
          otp_verified: true,
          profile_image: userProfileImage,
          fcmTokens: [],
          is_google_auth: true,
        });

        if (fcmToken) {
          console.log("📲 Adding FCM token to new user:", fcmToken);
          await user.addFcmToken(fcmToken);
        }
      } else {
        console.log("🔄 Existing user found:", user._id);

        if (user.register_type === "manual") {
          console.log("❌ Conflict: existing manual registration prevents Google login");
          return res.status(409).json({
            IsSucces: false,
            message: "Account exists with manual registration. Use manual login.",
          });
        }

        // Update missing name or profile image
        if (!user.name || user.name === "No Name") {
          console.log(`✏️ Updating user name from '${user.name}' to '${userName}'`);
          user.name = userName;
        }

        if (!user.profile_image && userProfileImage) {
          console.log(`✏️ Updating profile image for user`);
          user.profile_image = userProfileImage;
        }

        if (fcmToken) {
          console.log("📲 Adding FCM token to existing user:", fcmToken);
          await user.addFcmToken(fcmToken);
        }
      }

      // Create session & access token
      const session_id = randomUUID();
      const access_token = createAccessToken({ id: user._id, session_id });

      user.session_id = session_id;
      user.access_token = access_token;
      user.otp_verified = true;

      await user.save();
      console.log("🔑 Google login session & access token saved");

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
          fcmToken: user.fcmTokens,
          is_google_auth: user.is_google_auth,
        },
      });
    }

    // -------------------- INVALID LOGIN TYPE --------------------
    console.log("❌ Invalid login_type:", login_type);
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
    if (
      typeof user.otp_attempt_version === "undefined" ||
      user.otp_attempt_version === null
    ) {
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

// ---------------- FORGOT / RESET (single route) ----------------
/**
 * POST /auth/forgot-password
 *
 * Two modes depending on the request body:
 * 1) Request reset link: body: { email }
 * 2) Perform reset:     body: { email, token, new_password }
 */

exports.forgotOrResetPassword = async (req, res) => {
  try {
    const { email, token, new_password } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });
    }

    const lowerEmail = String(email).toLowerCase();
    const user = await User.findOne({ email: lowerEmail });
    if (!user) {
      // Keep same behavior as your other endpoints (404). You can also return generic response for security.
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });
    }

    // Mode 1: request reset (no token & no new_password provided)
    if (!token && !new_password) {
      // Optionally block google_auth accounts from password reset
      if (user.register_type === "google_auth" || user.is_google_auth) {
        return res.status(400).json({
          IsSucces: false,
          message: "Password reset not allowed for Google accounts",
        });
      }

      // Optional cooldown for abuse prevention
      const COOLDOWN_SECONDS = 60;
      if (user.lastResetRequestAt) {
        const elapsedSec = Math.floor(
          (Date.now() - new Date(user.lastResetRequestAt).getTime()) / 1000
        );
        if (elapsedSec < COOLDOWN_SECONDS) {
          return res.status(429).json({
            IsSucces: false,
            message: `Please wait ${
              COOLDOWN_SECONDS - elapsedSec
            } seconds before requesting again.`,
          });
        }
      }

      // Generate secure token + hashed version
      const { token: plainToken, hashed } = createResetToken();
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

      user.reset_password_token = hashed;
      user.reset_password_expiry = expiry;
      user.reset_password_used = false;
      user.lastResetRequestAt = new Date();

      await user.save();

      // Send email with plaintext token link (best-effort)
      try {
        await sendResetEmail(user.email, plainToken);
      } catch (emailErr) {
        console.error("Failed to send reset email (non-fatal):", emailErr);
        // Still respond success to avoid leaking info
      }

      return res.json({
        IsSucces: true,
        message: "If the email is registered, a reset link has been sent.",
      });
    }

    // Mode 2: perform reset (token + new_password provided)
    if (!token || !new_password) {
      return res.status(400).json({
        IsSucces: false,
        message: "Token and new_password required to reset password.",
      });
    }

    // check there's an active reset
    if (!user.reset_password_token || !user.reset_password_expiry) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "No active reset request found" });
    }

    if (user.reset_password_used) {
      return res.status(400).json({
        IsSucces: false,
        message: "This reset link has already been used",
      });
    }

    // check expiry
    if (Date.now() > new Date(user.reset_password_expiry).getTime()) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Reset link expired" });
    }

    // validate token
    const hashedToken = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");
    if (hashedToken !== user.reset_password_token) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Invalid reset token" });
    }

    // all good -> update password
    const hashedPassword = await bcrypt.hash(String(new_password), 10);
    user.hashed_password = hashedPassword;

    // invalidate reset token so link cannot be reused
    user.reset_password_token = null;
    user.reset_password_expiry = null;
    user.reset_password_used = true;
    user.lastPasswordResetAt = new Date();

    await user.save();

    return res.json({
      IsSucces: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    console.error("❌ forgotOrResetPassword Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};
