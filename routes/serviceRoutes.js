const express = require("express");
const router = express.Router();
const serviceController = require("../controller/serviceController");
const auth=require("../Middleware/authMiddleware")
router.post("/create", auth, serviceController.createService);
router.get("/get", serviceController.getServices);
module.exports = router;
