const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const blogController = require("../controller/blogController");
const adminAuth = require("../Middleware/adminAuth");

// ==================================================
// 🖼 BLOG IMAGES (local disk — uploads/blog_images)
// ==================================================
const blogImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(process.cwd(), "uploads", "blog_images");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log("📁 uploads/blog_images folder auto-created");
    }

    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName =
      "blog_" +
      Date.now() +
      "_" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    cb(null, uniqueName);
  },
});

const uploadBlogImage = multer({
  storage: blogImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ==================================================
// ADMIN CRUD (protected — requires admin Bearer token)
// ==================================================
router.post(
  "/admin/create",
  adminAuth,
  uploadBlogImage.single("featuredImage"),
  blogController.createBlog,
);
router.get("/admin/all", adminAuth, blogController.getAllBlogsAdmin);
router.get("/admin/:id", adminAuth, blogController.getBlogByIdAdmin);
router.put(
  "/admin/update/:id",
  adminAuth,
  uploadBlogImage.single("featuredImage"),
  blogController.updateBlog,
);
router.delete("/admin/delete/:id", adminAuth, blogController.deleteBlog);

// ==================================================
// PUBLIC (website — no auth, published posts only)
// ==================================================
router.get("/", blogController.getPublishedBlogs);
router.get("/:slug", blogController.getBlogBySlug);

module.exports = router;
