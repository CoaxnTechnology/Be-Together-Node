const express = require("express");
const router = express.Router();
const serviceController = require("../controller/serviceController");
const auth = require("../Middleware/authMiddleware");
const checkServiceRestrictionJs = require("../Middleware/checkServiceRestriction");
//const authMiddleware = require("../Middleware/authMiddleware");
router.post("/create", auth, serviceController.createService);
router.post("/get", serviceController.getServices);
router.post("/user/search", serviceController.getInterestedUsers);
router.get("/getall", serviceController.getAllServices);
router.put("/update", auth, serviceController.updateService);
router.post("/getbyId", serviceController.getservicbyId);
router.post("/search", serviceController.searchServices);

module.exports = router;
//