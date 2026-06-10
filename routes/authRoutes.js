// routes/auth.js
const express = require("express");
const multer = require("multer");
const authController = require("../controller/authController");
const { resendOtpLimiter } = require("../Middleware/rateLimiter");
const path = require("path");
const {
  register,
  verifyOtpRegister,
  login,
  verifyOtpLogin,
  resendOtp,
} = require("../controller/authController");

const router = express.Router();
// =======================
// MULTER DISK STORAGE
// =======================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/profile_images");
  },
  filename: function (req, file, cb) {
    const uniqueName =
      "user_" +
      Date.now() +
      "_" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});

router.post("/register", upload.single("profile_image"), register);
router.post("/verify-otp-reg", verifyOtpRegister);
router.post("/login", login);
router.post("/verify-otp-login", verifyOtpLogin);
router.post("/resend-otp", resendOtp);
router.post("/forgot-password", authController.forgotOrResetPassword);
router.post("/logout",authController.logout)
module.exports = router;
