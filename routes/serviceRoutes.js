const express = require("express");
const router = express.Router();
const serviceController = require("../controller/serviceController");
const auth = require("../Middleware/authMiddleware");
router.post("/create", auth, serviceController.createService);
router.post("/get", serviceController.getServices);
router.post("/user/search", serviceController.getInterestedUsers);
router.get("/getall", serviceController.getAllServices);
module.exports = router;

