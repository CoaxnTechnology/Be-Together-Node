const express = require("express");
const router = express.Router();
const controller = require("../controller/promotionSubscription.controller");

// 1️⃣ Create Checkout
router.post(
  "/subscription/checkout",
  controller.createPromotionSubscriptionCheckout
);

// 2️⃣ Cancel Subscription
router.post(
  "/subscription/cancel",
  controller.cancelPromotionSubscription
);

module.exports = router;
