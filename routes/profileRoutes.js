const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
//const multer = require('multer');
const authMiddleware = require("../Middleware/authMiddleware");
const {
  getUserProfileByEmail,
  editProfile,
} = require("../controller/profileController");

const router = express.Router();

// ---------------- Storage Config ----------------
const storage = multer.memoryStorage();
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

module.exports = router;
