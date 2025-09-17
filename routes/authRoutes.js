const express = require("express");
const multer = require("multer");
const path = require("path");
const {
  register,
  verifyOtpRegister,
  login,
  verifyOtpLogin,
} = require("../controller/authController");

const router = express.Router();
//const upload = multer(); // memory storage

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "../uploads/profile_images"));
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });
router.post("/register", upload.single("profile_image"), register);
router.post("/verify-otp-reg", verifyOtpRegister);
router.post("/login", login);
router.post("/verify-otp-login", verifyOtpLogin);

module.exports = router;
