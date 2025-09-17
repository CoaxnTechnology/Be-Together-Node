// routes/auth.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  register,
  verifyOtpRegister,
  login,
  verifyOtpLogin,
} = require("../controller/authController");

const router = express.Router();

// ensure upload dir exists
const uploadDir = path.join(__dirname, "../uploads/profile_images");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// storage with sanitized filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // use random prefix to avoid collisions and strip problematic chars
    const random = crypto.randomBytes(8).toString("hex");
    const safeName = file.originalname.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
    cb(null, `${Date.now()}-${random}-${safeName}`);
  },
});

// only allow common image types and limit size
function fileFilter(req, file, cb) {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only images are allowed"));
}

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

// route
router.post("/register", upload.single("profile_image"), register);
router.post("/verify-otp-reg", verifyOtpRegister);
router.post("/login", login);
router.post("/verify-otp-login", verifyOtpLogin);

module.exports = router;
