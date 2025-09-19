// routes/auth.js
const express = require("express");
const multer = require("multer");
const authController = require("../controller/authController");
const { resendOtpLimiter } = require("../Middleware/rateLimiter");
const {
  register,
  verifyOtpRegister,
  login,
  verifyOtpLogin,
  resendOtp,
} = require("../controller/authController");

const router = express.Router();

const storage = multer.memoryStorage();
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
module.exports = router;
