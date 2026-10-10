const express = require("express");
const router = express.Router();
const multer = require("multer");
const blogController = require("../controller/blogController");
const adminAuth = require("../Middleware/adminAuth");

// ==================================================
// 🖼 BLOG IMAGES
// Kept in memory only — blogController compresses/resizes the buffer with
// sharp and writes the final optimized file to uploads/blog_images itself,
// so raw (uncompressed) uploads never touch disk.
// ==================================================
const uploadBlogImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB raw upload cap (before compression)
  fileFilter: function (req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed for featuredImage"));
    }
    cb(null, true);
  },
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
