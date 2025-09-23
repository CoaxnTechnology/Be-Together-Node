const express = require("express");
const router = express.Router();
const serviceController = require("../controller/serviceController");

router.post("/create", /* auth, */ serviceController.createService);
router.get("/get", serviceController.getServices);
module.exports = router;
