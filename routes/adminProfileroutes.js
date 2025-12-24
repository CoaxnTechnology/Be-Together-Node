const express = require("express");
const router = express.Router();

const adminAuth = require("../Middleware/adminAuth");
const adminProfileController = require("../controller/adminProfileController");

// ================= PROFILE =================
// 🔹 Get admin profile (for profile page load)
router.get(
  "/",
  (req, res, next) => {
    console.log("➡️ GET /api/admin/profile route hit");
    next();
  },
  adminAuth,
  adminProfileController.getProfile
);
// 🔹 Update mobile number
router.put(
  "/update-mobile",
  adminAuth,
  adminProfileController.updateMobile
);

// 🔹 Update password
router.put(
  "/update-password",
  adminAuth,
  adminProfileController.updatePassword
);

// ================= EMAIL OTP =================

// 🔹 Send OTP for email update
router.post(
  "/email/send-otp",
  adminAuth,
  adminProfileController.sendEmailOtp
);

// 🔹 Verify OTP & update email
router.post(
  "/email/verify-otp",
  adminAuth,
  adminProfileController.verifyEmailOtp
);

// ================= SUPPORT SETTINGS =================

// 🔹 Get support info (public)
router.get(
  "/support",
  adminProfileController.getSupportInfo
);

// 🔹 Update support info (admin only)
router.put(
  "/support",
  adminAuth,
  adminProfileController.updateSupportInfo
);

module.exports = router;
