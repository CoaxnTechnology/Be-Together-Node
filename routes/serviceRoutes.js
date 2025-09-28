const express = require("express");
const router = express.Router();
const serviceController = require("../controller/serviceController");
const auth = require("../Middleware/authMiddleware");
router.post("/create", auth, serviceController.createService);
router.post("/get", serviceController.getServices);
router.get("/user/search", serviceController.searchUsers);
router.get("/getall",serviceController.getAllServices)
module.exports = router;



//23.0334462
// 72.5955886