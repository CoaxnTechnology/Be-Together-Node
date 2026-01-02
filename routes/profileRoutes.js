const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const authMiddleware = require("../Middleware/authMiddleware");
const {
  getUserProfileByEmail,
  editProfile,
  getProfileByEmail,
  getProfileById,
} = require("../controller/profileController");

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

// ---------------- Storage Config ----------------
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});
// ---------------- Routes ----------------
router.post("/user/profile", authMiddleware, getUserProfileByEmail);
router.put(
  "/update/profile",
  authMiddleware,
  upload.single("profile_image"),
  editProfile
);
router.post("/profile", getProfileById);

module.exports = router;
