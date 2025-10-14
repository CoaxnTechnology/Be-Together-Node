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
  generateFakeUsers,
  getFakeUsers,
  deleteFakeUser,
  getFakeUserById,
  editProfile,
} = require("../controller/Admin");
//const { getAllServices } = require("../controller/serviceController");
const storage = multer.memoryStorage();
const upload = multer({ storage });

//------------------------USer Details---------------------
router.get("/alluser", getAllUsers);
router.get("/allservice", getAllService);

//------------------------Service Details---------------------

router.get("/service/:id", getServiceById);
router.get("/fake-users/:id", getFakeUserById);
router.put(
  "/user/edit-profile/:userId",
  upload.single("profile_image"),
  editProfile
);

//-------------------category-------------------
router.post("/category/create", upload.single("image"), createCategory);
router.put("/category/update/:id", upload.single("image"), updateCategory);
router.delete("/category/delete/:id", deleteCategory);
router.post("/generate-fake-users", async (req, res, next) => {
  return generateFakeUsers(req, res, next);
});
router.get("/fake-users", getFakeUsers);

router.delete("/fake-users/:id", deleteFakeUser);
router.get("/:id", getUserById);
router.post("/category/all", getAllCategories);

module.exports = router;
