const express = require("express");
const router = express.Router();
const controller = require("../controller/promotionSubscription.controller");
const auth = require("../Middleware/authMiddleware");
// 1️⃣ Create Checkout
router.post(
  "/subscription/checkout",auth,
  controller.createPromotionSubscriptionCheckout
);

// 2️⃣ Cancel Subscription
router.post(
  "/subscription/cancel",auth,
  controller.cancelPromotionSubscription
);

module.exports = router;
