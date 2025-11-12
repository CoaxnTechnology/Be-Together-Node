const express = require("express");
const router = express.Router();
const adminCommissionController = require("../controller/adminCommissionController");

router.get("/", adminCommissionController.getCommission);
router.put("/", adminCommissionController.updateCommission);

module.exports = router;
