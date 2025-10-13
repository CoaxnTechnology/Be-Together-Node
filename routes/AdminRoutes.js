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
  getServiceById,
  getAllService,
} = require("../controller/Admin");
//const { getAllServices } = require("../controller/serviceController");
const storage = multer.memoryStorage();
const upload = multer({ storage });

//------------------------USer Details---------------------
router.get("/alluser",getAllUsers)
router.get("/allservice",getAllService)


//------------------------Service Details---------------------
 
 router.get("/service/:id",getServiceById)
 router.get("/:id", getUserById);
//-------------------category-------------------
router.post("/category/create", upload.single("image"), createCategory);
router.put("/category/update/:id", upload.single("image"), updateCategory);
router.delete("/category/delete/:id", deleteCategory);
router.get("/category/all", getAllCategories);





module.exports = router;
