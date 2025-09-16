const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const  authMiddleware  = require("../Middleware/authMiddleware");
const {
  getUserProfileByEmail,
  editProfile,
} = require("../controller/profileController");

const router = express.Router();

// ---------------- Storage Config ----------------
const UPLOAD_DIR = path.join(__dirname, "../uploads/profile_images");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});

const upload = multer({ storage });

// ---------------- Routes ----------------
router.post("/user/profile", authMiddleware, getUserProfileByEmail);
router.put(
  "/update/profile",
  authMiddleware,
  upload.single("profile_image"),
  editProfile
);

module.exports = router;
