const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getUserById,
  getAllUsers,
} = require("../controller/Admin");
const storage = multer.memoryStorage();
const upload = multer({ storage });

//-------------------category-------------------
router.post("/create", upload.single("image"), createCategory);
router.get("/getall", getAllCategories);
router.put("/category/update/:id", upload.single("image"), updateCategory);
router.delete("/category/delete/:id", deleteCategory);
//------------------------USer Details---------------------
router.get("/alluser",getAllUsers)
router.get("/:id", getUserById);


module.exports = router;
