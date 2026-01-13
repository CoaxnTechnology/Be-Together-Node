const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const auth = require("../Middleware/authMiddleware");
const {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getUserById,
  getAllUsers,
  getServiceById,
  getAllService,
  generateFakeUsers,
  getFakeUsers,
  deleteFakeUser,
  getFakeUserById,
  editProfile,
  createService,
  getAITags,
  loginAdmin,
  generateUsersFromCSV,
  deleteAllFakeUsers,
  getAllBookings,
  getBookingDetails,
  getAllPayments,
  updateService,
  adminForceDeleteService,
  getPendingDeleteCount,
} = require("../controller/Admin");
const adminAuth = require("../Middleware/adminAuth");
const path = require("path");

// ==================================================
// 📦 MULTER CONFIGS (SEPARATE & CLEAN)
// ==================================================

// 🖼 SERVICE IMAGES (disk)
const serviceImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/service_images");
  },
  filename: function (req, file, cb) {
    const uniqueName =
      "service_" +
      Date.now() +
      "_" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const uploadServiceImage = multer({
  storage: serviceImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// 👤 PROFILE IMAGES (disk)
const profileImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/profile_images");
  },
  filename: function (req, file, cb) {
    const uniqueName =
      "profile_" +
      Date.now() +
      "_" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const uploadProfileImage = multer({
  storage: profileImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// 📄 CSV UPLOAD (memory only)
const uploadCSV = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
// 🏷 CATEGORY IMAGES (disk)
const categoryImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    // ✅ Absolute path (VERY IMPORTANT)
    const uploadDir = path.join(
      process.cwd(),
      "uploads",
      "category_images"
    );

    // ✅ Auto-create folder if missing
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log("📁 uploads/category_images folder auto-created");
    }

    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    const uniqueName =
      "category_" +
      Date.now() +
      "_" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    cb(null, uniqueName);
  },
});


const uploadCategoryImage = multer({
  storage: categoryImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ------------------------USER DETAILS------------------------
router.get("/alluser", getAllUsers);
router.get("/user/:id", getUserById); // ✅ make generic user route specific

// ------------------------SERVICE DETAILS------------------------
router.get("/allservice", getAllService);
router.get("/service/:id", getServiceById);
router.patch(
  "/service/update",
  //adminAuth,
  uploadServiceImage.single("image"), // service image
  updateService
);
// ------------------------FAKE USERS------------------------
router.get("/fake-users", getFakeUsers);
router.get("/fake-users/:id", getFakeUserById);

router.delete("/fake-users/:id", deleteFakeUser);
router.delete("/fake-users", deleteAllFakeUsers);
router.post("/upload-users-csv", uploadCSV.single("file"), generateUsersFromCSV);

// ------------------------PROFILE------------------------
router.put(
  "/user/edit-profile/:userId",
  uploadProfileImage.single("profile_image"),
  editProfile
);
//admin delete the service---
router.delete(
  "/admin-force-delete/:serviceId",
  adminAuth, // 👈 MUST be admin
  adminForceDeleteService
);
// ------------------------CATEGORY------------------------
router.post("/category/ai-tags", getAITags);
router.post("/category/create", uploadCategoryImage.single("image"), createCategory);
router.put("/category/update/:id", uploadCategoryImage.single("image"), updateCategory);
router.delete("/category/delete/:id", deleteCategory);
router.post("/category/all", getAllCategories);

// ------------------------SERVICE CREATION------------------------

// ------------------------BOOKINGS------------------------
router.get("/allbooking", getAllBookings); // specific route

// ------------------------AUTH------------------------
router.post("/auth/login", loginAdmin);
//--------------------------payment----------------------------
router.get("/payment", getAllPayments);

// admin.routes.js
router.get(
  "/pending-delete-count",
  adminAuth,
  getPendingDeleteCount
);
//

module.exports = router;

