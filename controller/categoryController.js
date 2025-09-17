const Category = require("../model/Category");

// ➕ Add Category (single)
exports.addCategory = async (req, res) => {
  try {
    const { name, tags } = req.body;

    // Multer file is here
    const image = req.file ? "/uploads/icons/" + req.file.filename : null;

    // Check duplicate
    const existing = await Category.findOne({ name });
    if (existing) {
      return res.json({ isSuccess: false, message: "Category already exists" });
    }

    const tagsArray = tags
      ? tags.split(",").map((tag) => ({ name: tag.trim() }))
      : [];

    const category = new Category({
      name,
      image,
      tags: tagsArray,
    });

    await category.save();

    res.json({
      isSuccess: true,
      message: "Category added successfully",
      data: category,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};


// 📥 Get All Categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find();

    if (!categories || categories.length === 0) {
      return res.status(404).json({
        isSuccess: false,
        message: "Category not found",
      });
    }

    res.json({
      isSuccess: true,
      message: "Categories fetched successfully",
      data: categories,
    });
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
};

//JjwzFZ07W2smzdEo
//coaxntechnology_db_user

//mongodb+srv://coaxntechnology_db_user:JjwzFZ07W2smzdEo@bgtogether.xg507ee.mongodb.net/?retryWrites=true&w=majority&appName=BgTogether
