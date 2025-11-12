const express = require("express");
const router = express.Router();
const ctrl = require("../controller/paymentViolationController");
router.post("/auto-flag", ctrl.autoFlagViolation);
router.post("/pay-invoice", ctrl.payInvoice);
router.post("/review-appeal", ctrl.reviewAppeal);
module.exports = router;
