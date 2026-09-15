const fs = require("fs");
const path = require("path");
const Blog = require("../model/Blog");

const BLOG_IMAGE_DIR = path.join(process.cwd(), "uploads", "blog_images");

// ---------- Helpers ----------
function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureUniqueSlug(baseSlug, excludeId = null) {
  let slug = baseSlug;
  let counter = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = excludeId ? { slug, _id: { $ne: excludeId } } : { slug };
    const existing = await Blog.findOne(query).select("_id");
    if (!existing) return slug;
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
}

function normalizeArrayInput(value) {
  if (!value) return [];
  let parsed = value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        parsed = trimmed;
      }
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof parsed === "string") {
    return parsed
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function escapeRegExp(string = "") {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toBoolean(value) {
  return value === true || value === "true";
}

// Deletes a previously-uploaded blog image from local disk.
// Works whether `imageValue` is a full URL or a relative path — only the
// filename portion matters since every blog image lives in BLOG_IMAGE_DIR.
function deleteLocalBlogImage(imageValue) {
  if (!imageValue) return;
  try {
    const filename = path.basename(imageValue);
    const filePath = path.join(BLOG_IMAGE_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("🗑 Blog image deleted:", filePath);
    }
  } catch (err) {
    console.error("Failed to delete blog image:", err.message);
  }
}

function buildImageUrl(filename) {
  return `${process.env.BASE_URL}/uploads/blog_images/${filename}`;
}

// =====================================================================
// ADMIN: CREATE BLOG
// =====================================================================
exports.createBlog = async (req, res) => {
  try {
    const {
      title,
      slug,
      focusKeyword,
      excerpt,
      content,
      featuredPost,
      category,
      tags,
      author,
      metaTitle,
      metaDescription,
      metaKeywords,
      canonicalUrl,
      status,
      featuredImage, // optional: already-hosted image URL instead of a file
    } = req.body;

    if (!title || !String(title).trim()) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Title is required" });
    }
    if (!content || !String(content).trim()) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Content is required" });
    }

    const baseSlug = slugify(slug && String(slug).trim() ? slug : title);
    if (!baseSlug) {
      return res.status(400).json({
        isSuccess: false,
        message: "Could not generate a valid slug from the title",
      });
    }
    const finalSlug = await ensureUniqueSlug(baseSlug);

    let imageUrl = featuredImage || null;
    if (req.file) {
      imageUrl = buildImageUrl(req.file.filename);
    }

    const finalStatus = status === "published" ? "published" : "draft";

    const blog = await Blog.create({
      title: title.trim(),
      slug: finalSlug,
      focusKeyword: focusKeyword || null,
      excerpt: excerpt || null,
      content,
      featuredPost: toBoolean(featuredPost),
      category: category || null,
      tags: normalizeArrayInput(tags),
      author: author || null,
      featuredImage: imageUrl,
      metaTitle: metaTitle || null,
      metaDescription: metaDescription || null,
      metaKeywords: metaKeywords || null,
      canonicalUrl: canonicalUrl || null,
      status: finalStatus,
      publishedAt: finalStatus === "published" ? new Date() : null,
    });

    return res.status(201).json({
      isSuccess: true,
      message: "Blog created successfully",
      data: blog,
    });
  } catch (err) {
    // Uploaded file already saved to disk — clean it up since the DB write failed
    if (req.file) deleteLocalBlogImage(req.file.filename);

    if (err.code === 11000) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Slug already exists" });
    }
    console.error("createBlog error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// ADMIN: GET ALL BLOGS (all statuses, filterable + paginated)
// =====================================================================
exports.getAllBlogsAdmin = async (req, res) => {
  try {
    const { status, category, search, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    if (search && search.trim()) {
      const regex = new RegExp(escapeRegExp(search.trim()), "i");
      query.$or = [{ title: regex }, { slug: regex }, { focusKeyword: regex }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);

    const [blogs, total] = await Promise.all([
      Blog.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Blog.countDocuments(query),
    ]);

    return res.json({
      isSuccess: true,
      message: "Blogs fetched successfully",
      data: blogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    console.error("getAllBlogsAdmin error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// ADMIN: GET BLOG BY ID
// =====================================================================
exports.getBlogByIdAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Blog not found" });
    }
    return res.json({
      isSuccess: true,
      message: "Blog fetched successfully",
      data: blog,
    });
  } catch (err) {
    console.error("getBlogByIdAdmin error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// ADMIN: UPDATE BLOG
// =====================================================================
exports.updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) {
      if (req.file) deleteLocalBlogImage(req.file.filename);
      return res
        .status(404)
        .json({ isSuccess: false, message: "Blog not found" });
    }

    const {
      title,
      slug,
      focusKeyword,
      excerpt,
      content,
      featuredPost,
      category,
      tags,
      author,
      metaTitle,
      metaDescription,
      metaKeywords,
      canonicalUrl,
      status,
      featuredImage,
      removeFeaturedImage,
    } = req.body;

    if (title !== undefined && String(title).trim()) blog.title = title.trim();

    if (slug !== undefined && String(slug).trim()) {
      blog.slug = await ensureUniqueSlug(slugify(slug), blog._id);
    } else if (title !== undefined && String(title).trim() && !blog.slug) {
      blog.slug = await ensureUniqueSlug(slugify(title), blog._id);
    }

    if (focusKeyword !== undefined) blog.focusKeyword = focusKeyword || null;
    if (excerpt !== undefined) blog.excerpt = excerpt || null;
    if (content !== undefined) blog.content = content;
    if (featuredPost !== undefined) blog.featuredPost = toBoolean(featuredPost);
    if (category !== undefined) blog.category = category || null;
    if (tags !== undefined) blog.tags = normalizeArrayInput(tags);
    if (author !== undefined) blog.author = author || null;
    if (metaTitle !== undefined) blog.metaTitle = metaTitle || null;
    if (metaDescription !== undefined)
      blog.metaDescription = metaDescription || null;
    if (metaKeywords !== undefined) blog.metaKeywords = metaKeywords || null;
    if (canonicalUrl !== undefined) blog.canonicalUrl = canonicalUrl || null;

    // Featured image: new file > explicit removal > explicit URL string
    if (req.file) {
      deleteLocalBlogImage(blog.featuredImage); // ⭐ delete OLD image
      blog.featuredImage = buildImageUrl(req.file.filename);
    } else if (toBoolean(removeFeaturedImage)) {
      deleteLocalBlogImage(blog.featuredImage);
      blog.featuredImage = null;
    } else if (featuredImage !== undefined) {
      blog.featuredImage = featuredImage || null;
    }

    if (status !== undefined && ["draft", "published"].includes(status)) {
      if (status === "published" && blog.status !== "published") {
        blog.publishedAt = new Date();
      }
      if (status === "draft") {
        blog.publishedAt = null;
      }
      blog.status = status;
    }

    await blog.save();

    return res.json({
      isSuccess: true,
      message: "Blog updated successfully",
      data: blog,
    });
  } catch (err) {
    if (req.file) deleteLocalBlogImage(req.file.filename);

    if (err.code === 11000) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "Slug already exists" });
    }
    console.error("updateBlog error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// ADMIN: DELETE BLOG
// =====================================================================
exports.deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Blog not found" });
    }

    deleteLocalBlogImage(blog.featuredImage); // ⭐ delete image with the blog
    await Blog.findByIdAndDelete(id);

    return res.json({ isSuccess: true, message: "Blog deleted successfully" });
  } catch (err) {
    console.error("deleteBlog error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// PUBLIC: GET PUBLISHED BLOGS (for the website)
// =====================================================================
exports.getPublishedBlogs = async (req, res) => {
  try {
    const {
      category,
      tag,
      search,
      featured,
      page = 1,
      limit = 12,
    } = req.query;

    const query = { status: "published" };
    if (category) query.category = category;
    if (tag) query.tags = tag;
    if (toBoolean(featured)) query.featuredPost = true;
    if (search && search.trim()) {
      const regex = new RegExp(escapeRegExp(search.trim()), "i");
      query.$or = [{ title: regex }, { excerpt: regex }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 12);

    const [blogs, total] = await Promise.all([
      Blog.find(query)
        .select("-content")
        .sort({ publishedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Blog.countDocuments(query),
    ]);

    return res.json({
      isSuccess: true,
      message: "Blogs fetched successfully",
      data: blogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    console.error("getPublishedBlogs error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// =====================================================================
// PUBLIC: GET PUBLISHED BLOG BY SLUG (for the website's detail page)
// =====================================================================
exports.getBlogBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const blog = await Blog.findOne({ slug, status: "published" });
    if (!blog) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Blog not found" });
    }
    return res.json({
      isSuccess: true,
      message: "Blog fetched successfully",
      data: blog,
    });
  } catch (err) {
    console.error("getBlogBySlug error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
