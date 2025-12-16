const express = require("express");
const router = express.Router();
const serviceController = require("../controller/serviceController");
const auth = require("../Middleware/authMiddleware");
const checkServiceRestrictionJs = require("../Middleware/checkServiceRestriction");
//const authMiddleware = require("../Middleware/authMiddleware");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});
router.post(
  "/create",
  auth,
  upload.single("image"),
  serviceController.createService
);
router.post("/get", serviceController.getServices);
router.post("/user/search", serviceController.getInterestedUsers);
router.get("/getall", serviceController.getAllServices);
router.put("/update", auth, serviceController.updateService);
router.post("/getbyId", serviceController.getservicbyId);
router.post("/search", serviceController.searchServices);

module.exports = router;
//
