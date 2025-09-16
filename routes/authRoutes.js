const express = require("express");
const multer = require("multer");
const {
  register,
  verifyOtpRegister,
  login,
  verifyOtpLogin,
} = require("../controller/authController");

const router = express.Router();
const upload = multer(); // memory storage

router.post("/register", upload.single("profile_image"), register);
router.post("/verify-otp-reg", verifyOtpRegister);
router.post("/login", login);
router.post("/verify-otp-login", verifyOtpLogin);

module.exports = router;
