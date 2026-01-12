const express = require("express");
const router = express.Router();
const serviceController = require("../controller/serviceController");
const auth = require("../Middleware/authMiddleware");
const checkServiceRestrictionJs = require("../Middleware/checkServiceRestriction");
const path = require("path");
//const authMiddleware = require("../Middleware/authMiddleware");
const multer = require("multer");
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/service_images");
  },
  filename: function (req, file, cb) {
    const uniqueName =
      "service_" +
      Date.now() +
      "_" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

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
router.put(
  "/update",
  auth,
  upload.single("image"),
  serviceController.updateService
);
router.post("/getbyId", serviceController.getservicbyId);
router.post("/search", serviceController.searchServices);

// 🧑‍🔧 Owner deletes service
// ✅ STATIC ROUTES FIRST
router.get(
  "/delete-requests",
  serviceController.getDeleteServiceRequests
);

// ✅ ADMIN ACTIONS (explicit paths)
router.post(
  "/approve-delete/:serviceId",

  serviceController.approveServiceDelete
);

router.post(
  "/reject-delete/:serviceId",

  serviceController.rejectServiceDelete
);

// 🧑‍🔧 OWNER DELETE
router.delete("/delete", auth, serviceController.deleteService);

module.exports = router;
//
