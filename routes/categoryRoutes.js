const express = require("express");
const router = express.Router();
const categoryController = require("../controller/categoryController");
const multer = require("multer");
const path = require("path");
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});

// ➕ Add Category
router.post("/add", upload.single("image"), categoryController.addCategory);

// 📥 Get Categories
router.get("/all", categoryController.getCategories);

module.exports = router;
