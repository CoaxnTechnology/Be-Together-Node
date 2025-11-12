const express = require("express");
const router = express.Router();
const paymentController = require("../controller/paymentController");

router.post("/create", paymentController.createStripePayment);
router.post("/refund", paymentController.refundPayment);
router.post("/capture/:paymentId", paymentController.capturePayment);


module.exports = router;
