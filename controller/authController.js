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
const Wallet = require("../model/Wallet");
const generateReferralCode = require("../utils/generateReferralCode");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const ReferralHistory = require("../model/ReferralHistory");
const processReferralReward = require("../utils/processReferralReward");
const multer = require("multer"); // for MulterError checks
const TEST_EMAIL = "mansuria.hannan09@gmail.com";
const STATIC_OTP = "1234";
const appleSigninAuth = require("apple-signin-auth");
// =====================================
// GDPR SAVE HELPER
// =====================================
const saveGdprData = async (user, req) => {
  let isUpdated = false;

  if (typeof req.body.termsAccepted === "boolean") {
    user.termsAccepted = req.body.termsAccepted;
    isUpdated = true;
  }

  if (typeof req.body.privacyAccepted === "boolean") {
    user.privacyAccepted = req.body.privacyAccepted;
    isUpdated = true;
  }

  if (!user.accepted_at) {
    user.accepted_at = new Date();
    isUpdated = true;
  }

  if (!user.ip_address) {
    user.ip_address =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress ||
      req.ip ||
      null;

    isUpdated = true;
  }

  if (!user.country && req.body.country) {
    user.country = req.body.country;
    isUpdated = true;
  }

  if (!user.cookie_preferences) {
    user.cookie_preferences = req.body.cookie_preferences || "accepted";

    isUpdated = true;
  }

  if (isUpdated) {
    await user.save();

    console.log("✅ GDPR data saved for:", user.email);
  }
};
const verifyAppleToken = async (identityToken) => {
  try {
    const appleData = await appleSigninAuth.verifyIdToken(identityToken, {
      audience: process.env.APPLE_CLIENT_ID, // ✅ bundle id
      ignoreExpiration: false,
    });
    return appleData;
  } catch (err) {
    console.log("❌ Apple token verify failed:", err);
    return null;
  }
};
// =====================================
// PROCESS REFERRAL REWARD
// =====================================

// ---------------- REGISTER ----------------
exports.register = async (req, res) => {
  console.log("🔵 STEP 1: register() called");

  try {
    console.log("🔵 STEP 2: Raw body:", req.body);
    console.log("🔵 STEP 3: File present:", !!req.file);

    let {
      name,
      email,
      mobile,
      password,
      register_type,
      provider_id,
      provider_uid,
      fcmToken,
      identityToken,
      // referral
      deviceId,
      referralCode,
      // ambassador
      ambassadorCode,
    } = req.body;

    console.log("🔵 STEP 4: Extracted fields:", {
      name,
      email,
      mobile,
      register_type,
      provider_id,
      provider_uid,
      hasPassword: !!password,
      fcmToken,
    });

    if (email) email = String(email).toLowerCase();
    // 🍎 APPLE TOKEN VERIFY (NO LOGIC CHANGE)
    if (register_type === "apple_auth") {
      if (!identityToken) {
        return res.status(400).json({
          IsSucces: false,
          message: "Apple identityToken required",
        });
      }

      const appleData = await verifyAppleToken(identityToken);

      if (!appleData) {
        return res.status(401).json({
          IsSucces: false,
          message: "Invalid Apple token",
        });
      }

      // override values safely
      provider_uid = appleData.sub;
      if (appleData.email) {
        email = appleData.email.toLowerCase();
      }
    }

    if (!["manual", "google_auth", "apple_auth"].includes(register_type)) {
      console.log("❌ STEP 5: Invalid register_type");
      return res
        .status(400)
        .json({ IsSucces: false, message: "Invalid register_type." });
    }

    if (!email && register_type !== "apple_auth") {
      console.log("❌ STEP 6: Email missing");
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required." });
    }

    console.log("🔵 STEP 7: Checking existing user…");
    let existing = null;

    // 🔥 FIRST check provider_uid (Apple main identity)
    if (provider_uid) {
      existing = await User.findOne({ provider_uid });
    }

    // 🔥 fallback email
    if (!existing && email) {
      existing = await User.findOne({ email });
    }
    console.log("🔵 STEP 8: Existing user:", existing ? true : false);

    // GOOGLE: If already exists → login
    if (existing && register_type === "google_auth") {
      console.log("🔵 STEP 9: Google user exists → logging in");

      if (existing.register_type === "manual") {
        console.log("❌ STEP 10: Google tries to login but manual exists");
        return res.status(409).json({
          IsSucces: false,
          message: "Email already registered with manual method.",
        });
      }
      // 🍎 APPLE: If already exists → login

      const session_id = randomUUID();
      const access_token = createAccessToken({ id: existing._id, session_id });

      existing.session_id = session_id;
      existing.access_token = access_token;
      existing.otp_verified = true;
      existing.login_type = "google_auth";
      existing.last_login = new Date();
      if (provider_id) existing.provider_id = provider_id;
      if (provider_uid) existing.provider_uid = provider_uid;

      if (fcmToken) {
        console.log("🔵 STEP 11: Adding FCM token");
        await existing.addFcmToken(fcmToken);
      }
      // generate referral code
      if (!existing.referralCode) {
        existing.referralCode = await generateReferralCode(
          existing.name || "USER",
        );
      }

      await existing.save();
      await saveGdprData(existing, req);
      console.log("🔵 STEP 12: Google login success");
      // create wallet
      const existingWallet = await Wallet.findOne({
        user: existing._id,
      });

      if (!existingWallet) {
        await Wallet.create({
          user: existing._id,
        });

        console.log("✅ Wallet created");
      }

      // process referral
      await processReferralReward(existing);
      return res.status(200).json({
        IsSucces: true,
        message: "Login (existing google account).",
        access_token,
        session_id,
        token_type: "bearer",
        user: existing,
        referralCode: existing.referralCode,
      });
    }
    if (existing && register_type === "apple_auth") {
      console.log("🍎 Apple user exists → logging in");

      if (existing.register_type === "manual") {
        return res.status(409).json({
          IsSucces: false,
          message: "Email already registered with manual method.",
        });
      }

      const session_id = randomUUID();
      const access_token = createAccessToken({
        id: existing._id,
        session_id,
      });

      existing.session_id = session_id;
      existing.access_token = access_token;
      existing.otp_verified = true;
      existing.login_type = "apple_auth";
      existing.last_login = new Date();
      if (provider_uid) existing.provider_uid = provider_uid;

      if (fcmToken) {
        await existing.addFcmToken(fcmToken);
      }
      // generate referral code
      if (!existing.referralCode) {
        existing.referralCode = await generateReferralCode(
          existing.name || "USER",
        );
      }
      await existing.save();
      await saveGdprData(existing, req);
      // create wallet
      const existingWallet = await Wallet.findOne({
        user: existing._id,
      });

      if (!existingWallet) {
        await Wallet.create({
          user: existing._id,
        });

        console.log("✅ Wallet created");
      }

      // process referral
      await processReferralReward(existing);

      return res.status(200).json({
        IsSucces: true,
        message: "Login (existing apple account).",
        access_token,
        session_id,
        token_type: "bearer",
        user: existing,
        referralCode: existing.referralCode,
      });
    }
    // MANUAL: email exists
    // =====================================
    // MANUAL REGISTRATION RESUME
    // =====================================

    if (existing && register_type === "manual") {
      console.log(
        "🔵 MANUAL RESUME: Existing user found for manual registration",
        {
          email: existing.email,
          otp_verified: existing.otp_verified,
          hasPassword: !!existing.hashed_password,
        },
      );

      // Registration already completed
      if (existing.otp_verified && existing.hashed_password) {
        return res.status(409).json({
          IsSucces: false,
          message: "Email already registered.",
        });
      }

      // Password required
      if (!password) {
        return res.status(400).json({
          IsSucces: false,
          message: "Password required.",
        });
      }

      // Update latest information
      existing.name = name || existing.name;
      existing.mobile = mobile || existing.mobile;
      existing.hashed_password = await bcrypt.hash(String(password), 10);

      // Generate fresh OTP
      const otpObj = generateOTP();

      existing.otp_code = otpObj.otp;
      existing.otp_expiry = otpObj.expiry;
      existing.otp_verified = false;

      // Optional
      existing.lastResendAt = new Date();

      await existing.save();

      try {
        await sendOtpEmail(existing.email, otpObj.otp);
      } catch (err) {
        console.log("OTP Email Error:", err.message);
      }

      return res.status(200).json({
        IsSucces: true,
        requireOtp: true,
        isExistingUser: true,
        message: "Registration resumed. OTP sent successfully.",
      });
    }
    // MANUAL registration → create password + otp
    console.log("🔵 STEP 14: Handling password + OTP");

    let hashedPassword = null;
    let otp = null;
    let expiry = null;
    let otp_verified = false;

    if (register_type === "manual") {
      if (!password) {
        console.log("❌ STEP 15: Missing password");
        return res.status(400).json({
          IsSucces: false,
          message: "Password required for manual registration.",
        });
      }

      hashedPassword = await bcrypt.hash(String(password), 10);
      console.log("🔵 STEP 16: Password hashed");

      const otpObj = generateOTP();
      otp = otpObj.otp;
      expiry = otpObj.expiry;
      console.log("🔵 STEP 17: OTP generated:", otp);

      otp_verified = false;
    } else {
      console.log("🔵 STEP 18: Google Auth → OTP Auto Verified");
      otp_verified = true;
    }

    // PROFILE IMAGE
    console.log("🔵 STEP 19: Handling profile image…");

    let profileImageUrl = null;

    const baseUrl = process.env.BASE_URL;

    if (req.body.profile_image) {
      profileImageUrl = String(req.body.profile_image).trim();
    } else if (req.file) {
      profileImageUrl = `${baseUrl}/uploads/profile_images/${req.file.filename}`;
    }
    console.log("🔵 STEP 20: Profile image URL:", profileImageUrl);
    // =====================================
    // GENERATE USER REFERRAL CODE
    // =====================================

    // =====================================
    // REFERRAL SYSTEM
    // =====================================
    let referredBy = null;
    let registeredByAmbassador = null;
    let registeredByAmbassadorAt = null;
    let registeredAfterAmbassadorApproval = false;
    try {
      // ==========================
      // AMBASSADOR CODE
      // ==========================

      if (ambassadorCode) {
        const ambassador = await User.findOne({
          ambassadorCode: String(ambassadorCode).trim().toUpperCase(),
          isAmbassador: true,
          ambassadorStatus: "approved",
        });

        if (!ambassador) {
          return res.status(400).json({
            IsSucces: false,
            message: "Invalid ambassador code.",
          });
        }

        if (
          ambassador.email.trim().toLowerCase() !== email.trim().toLowerCase()
        ) {
          registeredByAmbassador = ambassador._id;
          registeredByAmbassadorAt = new Date();
          registeredAfterAmbassadorApproval = true;

          console.log("✅ Ambassador code applied");
        }
      } else if (referralCode) {
        // ==========================
        // 1. MANUAL REFERRAL CODE
        // ==========================

        const referralUser = await User.findOne({
          referralCode: String(referralCode).trim().toUpperCase(),
        });

        if (referralUser && referralUser.email !== email) {
          referredBy = referralUser._id;

          console.log("✅ Manual referral applied");
        }
      }
    } catch (err) {
      console.log("Referral skipped:", err.message);
    }
    // CREATE USER
    console.log("🔵 STEP 24: Creating new user document…");

    const newUser = new User({
      _id: new mongoose.Types.ObjectId(),
      name: name || null,
      email,
      mobile: mobile || null,
      hashed_password: hashedPassword,
      register_type,
      login_type: register_type, // ✅ ADD THIS
      otp_verified,
      otp_code: otp,
      otp_expiry: expiry,
      profile_image: profileImageUrl,
      referredBy: referredBy || null,
      // Ambassador
      registeredByAmbassador,
      registeredByAmbassadorAt,
      registeredAfterAmbassadorApproval,
      provider_id: provider_id || null,
      provider_uid: provider_uid || null,
      fcmTokens: [],
    });

    if (fcmToken) {
      console.log("🔵 STEP 25: Adding FCM token to new user");
      await newUser.addFcmToken(fcmToken);
    }

    await newUser.save();
    await saveGdprData(newUser, req);
    console.log("🔵 STEP 26: User saved in DB");
    // SEND OTP
    if (register_type === "manual") {
      console.log("🔵 STEP 27: Sending OTP email…");
      console.log("🧪 BREVO_API_KEY:", process.env.BREVO_API_KEY);

      try {
        await sendOtpEmail(email, otp);
        console.log("🔵 STEP 28: OTP sent successfully");
      } catch (emailErr) {
        console.log("❌ STEP 29: OTP email failed:", emailErr);
      }

      return res
        .status(201)
        .json({ IsSucces: true, message: "OTP sent. Please verify." });
    }

    // GOOGLE AUTH RESPONSE
    if (register_type === "google_auth") {
      console.log("🔵 STEP 30: Google registration → Creating session");
      // generate referral code
      if (!newUser.referralCode) {
        newUser.referralCode = await generateReferralCode(
          newUser.name || "USER",
        );
      }
      const session_id = randomUUID();
      const access_token = createAccessToken({ id: newUser._id, session_id });

      newUser.session_id = session_id;
      newUser.access_token = access_token;
      await newUser.save();

      console.log("🔵 STEP 31: Google auth user saved");
      // create wallet
      const existingWallet = await Wallet.findOne({
        user: newUser._id,
      });

      if (!existingWallet) {
        await Wallet.create({
          user: newUser._id,
        });
      }
      console.log("✅ Wallet created for new user");
      await processReferralReward(newUser);
      return res.status(201).json({
        IsSucces: true,
        message: "Registered successfully",
        access_token,
        session_id,
        token_type: "bearer",
        user: newUser,
        referralCode: newUser.referralCode,
      });
    }
    // APPLE AUTH RESPONSE
    if (register_type === "apple_auth") {
      console.log("🍎 Apple registration → Creating session");

      // generate referral code
      if (!newUser.referralCode) {
        newUser.referralCode = await generateReferralCode(
          newUser.name || "USER",
        );
      }

      const session_id = randomUUID();

      const access_token = createAccessToken({
        id: newUser._id,
        session_id,
      });

      newUser.session_id = session_id;

      newUser.access_token = access_token;

      await newUser.save();

      console.log("🍎 Apple auth user saved");
      // create wallet
      const existingWallet = await Wallet.findOne({
        user: newUser._id,
      });

      if (!existingWallet) {
        await Wallet.create({
          user: newUser._id,
        });
      }
      console.log("✅ Wallet created for new user");
      await processReferralReward(newUser);

      return res.status(201).json({
        IsSucces: true,

        message: "Registered successfully",

        access_token,

        session_id,

        token_type: "bearer",

        user: newUser,

        referralCode: newUser.referralCode,
      });
    }
    console.log("❌ STEP 32: Unknown error");
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  } catch (err) {
    console.log("❌ STEP 33: Register Error:", err);

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

    email = String(email).trim().toLowerCase();
    otp = String(otp);

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });
    }
    if (user.status === "banned" || user.is_active === false) {
      return res.status(403).json({
        IsSucces: false,
        message: "Your account has been blocked by admin",
      });
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
      identityToken,
    } = body;
    // ✅ Email check (Apple ko skip)
    if (!email && login_type !== "apple_auth") {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });
    }

    // Apple me email nahi bhi ho sakta
    let user = null;

    if (email && login_type !== "apple_auth") {
      user = await User.findOne({ email });
    }

    console.log("🔍 Fetched user from DB:", user);
    if (user && (user.status === "banned" || user.is_active === false)) {
      return res.status(403).json({
        IsSucces: false,
        message: "Your account has been blocked by admin",
      });
    }

    // -------------------- MANUAL LOGIN -----------------------
    if (login_type === "manual") {
      console.log("💻 Attempting manual login");

      if (!user) {
        console.log("❌ Manual login failed: user not found");
        return res
          .status(404)
          .json({ IsSucces: false, message: "User not found" });
      }
      if (user.registeredByAmbassador && !user.hashed_password) {
        return res.status(400).json({
          IsSucces: false,
          requirePasswordSetup: true,
          userId: user._id,
          message:
            "Please setup your password using the link sent to your email",
        });
      }

      if (!user.hashed_password || !password) {
        console.log("❌ Password missing for manual login");
        return res
          .status(400)
          .json({ IsSucces: false, message: "Password required" });
      }

      const valid = await bcrypt.compare(
        String(password),
        user.hashed_password,
      );
      console.log("🔑 Password valid?", valid);

      if (!valid) {
        console.log("❌ Manual login failed: invalid password");
        return res
          .status(401)
          .json({ IsSucces: false, message: "Invalid password" });
      }

      // ✅ OTP LOGIC (STATIC + NORMAL)
      let otp, expiry;

      if (email === TEST_EMAIL) {
        otp = STATIC_OTP;
        expiry = new Date(Date.now() + 10 * 60 * 1000);
        console.log("🧪 STATIC OTP USED:", otp);
      } else {
        const otpObj = generateOTP();
        otp = otpObj.otp;
        expiry = otpObj.expiry;
      }

      user.otp_code = otp;
      user.otp_expiry = expiry;
      user.otp_verified = false;
      user.login_type = "manual";

      if (fcmToken) {
        await user.addFcmToken(fcmToken);
      }

      await user.save();
      await saveGdprData(user, req);

      // ✅ SEND EMAIL (STATIC OTP bhi jayega)
      try {
        await sendOtpEmail(user.email, otp);
        console.log("OTP sent:", otp);
      } catch (err) {
        console.log("Email error:", err);
      }

      return res.json({
        IsSucces: true,
        message: "OTP sent. Please verify.",
        require_otp: true,
      });
    }

    // -------------------- GOOGLE LOGIN --------------------
    if (login_type === "google_auth") {
      console.log("🌐 Attempting Google login");
      if (user && user.registeredByAmbassador) {
        return res.status(403).json({
          IsSucces: false,
          message:
            "This account was created by an Ambassador. Please login using email and password.",
        });
      }

      const userName = name?.trim() || "No Name";
      const userProfileImage = profile_image?.trim() || null;

      if (!user) {
        console.log("🆕 User not found, creating new Google user");

        user = new User({
          email,
          name: userName,
          register_type: "google_auth",
          login_type: "google_auth", // ✅ ADD
          provider_id: provider_id || null,
          provider_uid: provider_uid || null,
          otp_verified: true,
          profile_image: userProfileImage,

          fcmTokens: [],
          is_google_auth: true,
        });
        // generate referral code
        user.referralCode = await generateReferralCode(userName || "USER");

        if (fcmToken) {
          console.log("📲 Adding FCM token to new user:", fcmToken);
          await user.addFcmToken(fcmToken);
        }
      } else {
        console.log("🔄 Existing user found:", user._id);
        // generate referral code for old users
        if (!user.referralCode) {
          user.referralCode = await generateReferralCode(user.name || "USER");

          console.log(
            "✅ Referral code generated for old Google user:",
            user.referralCode,
          );
        }
        if (user.register_type === "manual") {
          console.log(
            "❌ Conflict: existing manual registration prevents Google login",
          );
          return res.status(409).json({
            IsSucces: false,
            message:
              "Account exists with manual registration. Use manual login.",
          });
        }

        if (!user.name || user.name === "No Name") {
          console.log(
            `✏️ Updating user name from '${user.name}' to '${userName}'`,
          );
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

      const session_id = randomUUID();
      const access_token = createAccessToken({ id: user._id, session_id });

      user.session_id = session_id;
      user.access_token = access_token;
      user.otp_verified = true;
      user.login_type = "google_auth";
      user.last_login = new Date();
      await user.save();
      await saveGdprData(user, req);

      console.log("🔑 Google login session & access token saved");
      const existingWallet = await Wallet.findOne({
        user: user._id,
      });

      if (!existingWallet) {
        await Wallet.create({
          user: user._id,
        });
      }
      await processReferralReward(user);
      return res.json({
        IsSucces: true,
        message: "Login successful",
        access_token,
        session_id,
        token_type: "bearer",
        user: {
          id: user._id,
          referralCode: user.referralCode,
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
    if (login_type === "apple_auth") {
      console.log("🍎 Attempting Apple login");

      if (!identityToken) {
        return res.status(400).json({
          IsSucces: false,
          message: "Apple identityToken required",
        });
      }

      // ✅ VERIFY TOKEN
      const appleData = await verifyAppleToken(identityToken);

      if (!appleData) {
        return res.status(401).json({
          IsSucces: false,
          message: "Invalid Apple token",
        });
      }

      const appleUserId = appleData.sub;
      const appleEmail = appleData.email || null;

      let appleUser = null;

      // 🔥 FIRST find by provider_uid
      appleUser = await User.findOne({ provider_uid: appleUserId });

      // fallback email
      if (!appleUser && appleEmail) {
        appleUser = await User.findOne({ email: appleEmail.toLowerCase() });
      }
      if (appleUser && appleUser.registeredByAmbassador) {
        return res.status(403).json({
          IsSucces: false,
          message:
            "This account was created by an Ambassador. Please login using email and password.",
        });
      }
      // create user
      if (!appleUser) {
        appleUser = new User({
          email: appleEmail ? appleEmail.toLowerCase() : null,
          name: name || "Apple User",
          register_type: "apple_auth",
          login_type: "apple_auth", // ✅ ADD
          provider_uid: appleUserId,
          otp_verified: true,
          fcmTokens: [],
        });
        // generate referral code
        appleUser.referralCode = await generateReferralCode(name || "USER");

        if (fcmToken) {
          await appleUser.addFcmToken(fcmToken);
        }
      } else {
        // generate referral code for old users
        if (!appleUser.referralCode) {
          appleUser.referralCode = await generateReferralCode(
            appleUser.name || "USER",
          );

          console.log(
            "✅ Referral code generated for old Apple user:",
            appleUser.referralCode,
          );
        }

        if (appleUser.register_type === "manual") {
          return res.status(409).json({
            IsSucces: false,
            message: "Account exists with manual login",
          });
        }

        if (fcmToken) {
          await appleUser.addFcmToken(fcmToken);
        }
        await appleUser.save();
        await saveGdprData(appleUser, req);
      }

      const session_id = randomUUID();
      const access_token = createAccessToken({
        id: appleUser._id,
        session_id,
      });

      appleUser.session_id = session_id;
      appleUser.access_token = access_token;
      appleUser.otp_verified = true;
      appleUser.login_type = "apple_auth";
      appleUser.last_login = new Date();

      await appleUser.save();
      await saveGdprData(appleUser, req);

      // latest user

      const existingWallet = await Wallet.findOne({
        user: appleUser._id,
      });

      if (!existingWallet) {
        await Wallet.create({
          user: appleUser._id,
        });
      }
      // process referral
      await processReferralReward(appleUser);

      return res.json({
        IsSucces: true,
        message: "Apple login successful",
        access_token,
        session_id,
        token_type: "bearer",
        user: {
          ...appleUser.toObject(),

          referralCode: appleUser.referralCode,
        },
      });
    }
    console.log("❌ Invalid login_type:", login_type);
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
  console.log("🟦 STEP 1: verifyOtpLogin() called");

  try {
    const { email, otp } = req.body;

    console.log("🟦 STEP 2: Received body:", req.body);

    if (!email) {
      console.log("❌ STEP 3: Email missing");
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });
    }

    if (!otp) {
      console.log("❌ STEP 4: OTP missing");
      return res.status(400).json({ IsSucces: false, message: "OTP required" });
    }

    console.log("🟦 STEP 5: Checking user in DB");
    const user = await User.findOne({ email: String(email).toLowerCase() });

    console.log("🟦 STEP 6: User found?", !!user);

    if (!user) {
      console.log("❌ STEP 7: User not found");
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });
    }
    if (user.status === "banned" || user.is_active === false) {
      return res.status(403).json({
        IsSucces: false,
        message: "Your account has been blocked by admin",
      });
    }

    console.log("🟦 STEP 8: Checking if OTP exists");
    if (!user.otp_code || !user.otp_expiry) {
      console.log("❌ STEP 9: User has no OTP");
      return res
        .status(400)
        .json({ IsSucces: false, message: "No OTP generated" });
    }

    console.log("🟦 STEP 10: Checking OTP expiry");
    console.log("🟦 OTP Expiry:", user.otp_expiry);

    if (Date.now() > new Date(user.otp_expiry).getTime()) {
      console.log("❌ STEP 11: OTP expired");
      return res.status(400).json({ IsSucces: false, message: "OTP expired" });
    }

    console.log("🟦 STEP 12: Matching OTP");
    console.log("🟦 Saved OTP:", user.otp_code, " | Entered OTP:", otp);

    // ✅ STATIC OTP BYPASS
    if (email === TEST_EMAIL && otp === STATIC_OTP) {
      console.log("🧪 STATIC OTP VERIFIED");
    } else if (String(user.otp_code) !== String(otp)) {
      return res.status(400).json({ IsSucces: false, message: "Invalid OTP" });
    }

    console.log("🟦 STEP 14: OTP matched successfully");

    user.otp_verified = true;
    user.otp_code = null;
    user.otp_expiry = null;
    // =====================================
    // GENERATE REFERRAL CODE
    // AFTER OTP VERIFY
    // =====================================

    if (!user.referralCode) {
      user.referralCode = await generateReferralCode(user.name || "USER");

      console.log("✅ Referral code generated:", user.referralCode);
    }
    // =====================================
    // CREATE WALLET
    // =====================================

    const existingWallet = await Wallet.findOne({
      user: user._id,
    });

    if (!existingWallet) {
      await Wallet.create({
        user: user._id,
      });

      console.log("✅ Wallet created");
    }
    await processReferralReward(user);
    console.log("🟦 STEP 15: Generating session + tokens");
    const session_id = randomUUID();
    const access_token = createAccessToken({ id: user._id, session_id });

    user.session_id = session_id;
    user.access_token = access_token;
    user.login_type = "manual";
    user.last_login = new Date();

    console.log("🟦 STEP 16: Saving user after OTP verify");
    await user.save();
    await saveGdprData(user, req);
    const requiresAmbassadorAgreement =
      !!user.registeredByAmbassador &&
      (!user.ambassadorUserAgreementAccepted ||
        !user.termsAccepted ||
        !user.privacyAccepted);

    console.log("🟦 STEP 17: OTP login success");
    return res.json({
      IsSucces: true,
      message: "Success",
      access_token,
      session_id,
      token_type: "bearer",
      requiresAmbassadorAgreement,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        profile_image: getFullImageUrl(user.profile_image),
        register_type: user.register_type,
        otp_verified: user.otp_verified,
        referralCode: user.referralCode,
        login_type: user.login_type,
      },
    });
  } catch (err) {
    console.log("❌ STEP 18: verifyOtpLogin Error:", err);
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
    if (user.status === "banned" || user.is_active === false) {
      return res.status(403).json({
        IsSucces: false,
        message: "Your account has been blocked by admin",
      });
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
    console.log("🔐 [FORGOT/RESET] API HIT");
    console.log("📥 Request body:", req.body);

    const { email, token, new_password, confirm_password } = req.body;

    if (!email) {
      console.log("❌ Email missing");
      return res
        .status(400)
        .json({ isSuccess: false, message: "Email required" });
    }

    const lowerEmail = String(email).toLowerCase();
    console.log("📧 Normalized email:", lowerEmail);

    const user = await User.findOne({ email: lowerEmail });

    if (!user) {
      console.log("⚠️ User not found (safe response)");
      return res.json({
        isSuccess: true,
        message: "If the email is registered, a reset link has been sent.",
      });
    }

    console.log("👤 User found:", user._id);

    if (user.status === "banned" || user.is_active === false) {
      console.log("🚫 User blocked");
      return res.status(403).json({
        isSuccess: false,
        message: "Your account has been blocked by admin",
      });
    }

    // ===============================
    // MODE 1: REQUEST RESET LINK
    // ===============================
    if (!token && !new_password) {
      console.log("📨 MODE 1: Reset link request");

      if (user.register_type === "google_auth" || user.is_google_auth) {
        console.log("❌ Google auth user – reset blocked");
        return res.status(400).json({
          isSuccess: false,
          message: "Password reset is not allowed for Google accounts",
        });
      }

      const COOLDOWN_SECONDS = 60;
      if (user.lastResetRequestAt) {
        const elapsedSec = Math.floor(
          (Date.now() - new Date(user.lastResetRequestAt).getTime()) / 1000,
        );
        console.log("⏱ Cooldown elapsed:", elapsedSec);

        if (elapsedSec < COOLDOWN_SECONDS) {
          return res.status(429).json({
            isSuccess: false,
            message: `Please wait ${
              COOLDOWN_SECONDS - elapsedSec
            } seconds before requesting again.`,
          });
        }
      }

      const { token: plainToken, hashed } = createResetToken();
      const expiry = new Date(Date.now() + 60 * 60 * 1000);

      console.log("🔑 Plain token (email):", plainToken);
      console.log("🔐 Hashed token (DB):", hashed);
      console.log("⏳ Expiry:", expiry);

      user.reset_password_token = hashed;
      user.reset_password_expiry = expiry;
      user.reset_password_used = false;
      user.lastResetRequestAt = new Date();

      await user.save();
      console.log("💾 Reset token saved in DB");

      try {
        await sendResetEmail(user.email, plainToken);
        console.log("📧 Reset email sent");
      } catch (emailErr) {
        console.error("❌ Email send failed:", emailErr);
      }

      return res.json({
        isSuccess: true,
        message: "If the email is registered, a reset link has been sent.",
      });
    }

    // ===============================
    // MODE 2: RESET PASSWORD
    // ===============================
    console.log("🔁 MODE 2: Reset password attempt");

    if (!token || !new_password || !confirm_password) {
      console.log("❌ Missing token or passwords");
      return res.status(400).json({
        isSuccess: false,
        message: "Token, new_password and confirm_password are required.",
      });
    }

    console.log("🔑 Token received from frontend:", token);

    if (new_password !== confirm_password) {
      console.log("❌ Password mismatch");
      return res.status(400).json({
        isSuccess: false,
        message: "New password and confirm password do not match",
      });
    }

    if (String(new_password).length < 8) {
      console.log("❌ Password too short");
      return res.status(400).json({
        isSuccess: false,
        message: "Password must be at least 8 characters long",
      });
    }

    if (!user.reset_password_token || !user.reset_password_expiry) {
      console.log("❌ No active reset data in DB");
      return res.status(400).json({
        isSuccess: false,
        message: "No active reset request found",
      });
    }

    if (user.reset_password_used) {
      console.log("❌ Reset link already used");
      return res.status(400).json({
        isSuccess: false,
        message: "This reset link has already been used",
      });
    }

    if (Date.now() > new Date(user.reset_password_expiry).getTime()) {
      console.log("⏰ Reset link expired");

      user.reset_password_token = null;
      user.reset_password_expiry = null;
      user.reset_password_used = true;
      await user.save();

      return res.status(400).json({
        isSuccess: false,
        message: "Reset link expired",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(String(token))
      .digest("hex");

    console.log("🔐 Hashed token from request:", hashedToken);
    console.log("🗄 Hashed token in DB:", user.reset_password_token);

    if (hashedToken !== user.reset_password_token) {
      console.log("❌ TOKEN MISMATCH");
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid reset token",
      });
    }

    console.log("✅ Token verified");

    if (user.hashed_password) {
      const samePassword = await bcrypt.compare(
        new_password,
        user.hashed_password,
      );
      if (samePassword) {
        console.log("❌ Same password as old");
        return res.status(400).json({
          isSuccess: false,
          message: "New password must be different from old password",
        });
      }
    }

    const hashedPassword = await bcrypt.hash(String(new_password), 10);
    user.hashed_password = hashedPassword;
    user.passwordChangedByUser = true;

    user.reset_password_token = null;
    user.reset_password_expiry = null;
    user.reset_password_used = true;
    user.lastPasswordResetAt = new Date();
    await user.save();

    console.log("🎉 PASSWORD RESET SUCCESS");

    return res.json({
      isSuccess: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    console.error("❌ forgotOrResetPassword ERROR:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
};

// controller/authController.js

exports.logout = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ IsSucces: false, message: "Email required" });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      return res
        .status(404)
        .json({ IsSucces: false, message: "User not found" });
    }

    // Clear all FCM tokens
    user.fcmToken = [];

    // Clear session info
    user.session_id = null;
    user.access_token = null;

    await user.save();

    return res.json({
      IsSucces: true,
      message: "Logged out successfully, FCM tokens cleared",
    });
  } catch (err) {
    console.error("❌ Logout Error:", err);
    return res.status(500).json({ IsSucces: false, message: "Server error" });
  }
};
