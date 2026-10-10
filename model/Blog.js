const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema(
  {
    // ------------------------ Article Details ------------------------
    title: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    focusKeyword: { type: String, default: null, trim: true },
    excerpt: { type: String, default: null },
    content: { type: String, required: true }, // HTML content

    // ------------------------ Publishing Details ------------------------
    featuredPost: { type: Boolean, default: false },
    category: { type: String, default: null, trim: true },
    tags: [{ type: String, trim: true }],
    author: { type: String, default: null, trim: true },

    // ------------------------ Featured Image ------------------------
    featuredImage: { type: String, default: null }, // full URL, served from /uploads/blog_images

    // ------------------------ SEO Details ------------------------
    metaTitle: { type: String, default: null, trim: true },
    metaDescription: { type: String, default: null, trim: true },
    metaKeywords: { type: String, default: null, trim: true },
    canonicalUrl: { type: String, default: null, trim: true },

    // ------------------------ Publish State ------------------------
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }, // adds createdAt & updatedAt
);

module.exports = mongoose.model("Blog", blogSchema);
