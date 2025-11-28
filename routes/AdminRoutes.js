const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");

const storage = multer.memoryStorage();
const upload = multer({ storage });

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
  getAllPayments
} = require("../controller/Admin");

// ------------------------USER DETAILS------------------------
router.get("/alluser", getAllUsers);
router.get("/user/:id", getUserById); // ✅ make generic user route specific

// ------------------------SERVICE DETAILS------------------------
router.get("/allservice", getAllService);
router.get("/service/:id", getServiceById);

// ------------------------FAKE USERS------------------------
router.get("/fake-users", getFakeUsers);
router.get("/fake-users/:id", getFakeUserById);
router.post("/generate-fake-users", generateFakeUsers);
router.delete("/fake-users/:id", deleteFakeUser);
router.delete("/fake-users", deleteAllFakeUsers);
router.post("/upload-users-csv", upload.single("file"), generateUsersFromCSV);

// ------------------------PROFILE------------------------
router.put("/user/edit-profile/:userId", upload.single("profile_image"), editProfile);

// ------------------------CATEGORY------------------------
router.post("/category/ai-tags", getAITags);
router.post("/category/create", upload.single("image"), createCategory);
router.put("/category/update/:id", upload.single("image"), updateCategory);
router.delete("/category/delete/:id", deleteCategory);
router.post("/category/all", getAllCategories);

// ------------------------SERVICE CREATION------------------------
router.post("/create", createService);

// ------------------------BOOKINGS------------------------
router.get("/allbooking", getAllBookings);      // specific route

// ------------------------AUTH------------------------
router.post("/auth/login", loginAdmin);
//--------------------------payment----------------------------
router.get("/payment",getAllPayments)

module.exports = router;
//