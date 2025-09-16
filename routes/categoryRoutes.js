const express = require("express");
const router = express.Router();
const categoryController = require("../controller/categoryController");
const multer = require("multer");
const path = require("path");

// ---------------- Storage Config ----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/icons/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// ➕ Add Category
router.post("/add", upload.single("image"), categoryController.addCategory);

// 📥 Get Categories
router.get("/all", categoryController.getCategories);

module.exports = router;
