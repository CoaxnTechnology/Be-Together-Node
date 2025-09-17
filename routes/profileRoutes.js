// routes/profileRoutes.js (debug version)
const express = require("express");
const multer = require("multer");
const router = express.Router();

let authMiddleware;
let profileController;
try {
  authMiddleware = require("../Middleware/authMiddleware");
} catch (e) {
  console.error("require authMiddleware failed:", e && e.message);
  authMiddleware = null;
}
try {
  profileController = require("../controller/profileController");
} catch (e) {
  console.error("require profileController failed:", e && e.message);
  profileController = {};
}

const { getUserProfileByEmail, editProfile } = profileController || {};

// Multer - simple memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Log types
console.log("DEBUG: authMiddleware ->", typeof authMiddleware);
console.log("DEBUG: getUserProfileByEmail ->", typeof getUserProfileByEmail);
console.log("DEBUG: editProfile ->", typeof editProfile);
console.log("DEBUG: upload.single exists ->", upload && typeof upload.single);

// helper to ensure function
function ensureFn(fn, name) {
  if (typeof fn !== "function") {
    console.error(`Handler "${name}" is NOT a function. Using placeholder that returns 500.`);
    return (req, res) => res.status(500).json({ isSuccess: false, message: `${name} is not configured on server` });
  }
  return fn;
}

// Attach routes using validated handlers
router.post("/user/profile", ensureFn(authMiddleware, "authMiddleware"), ensureFn(getUserProfileByEmail, "getUserProfileByEmail"));
router.put("/update/profile", ensureFn(authMiddleware, "authMiddleware"), upload.single("profile_image"), ensureFn(editProfile, "editProfile"));

module.exports = router;
