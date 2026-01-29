const express = require("express");
const router = express.Router();

const {
  createPromotionSubscriptionCheckout,
  getPromotionSubscriptionFromSession,
  cancelPromotionSubscription,
} = require("../controller/promotionSubscription.controller");

router.post(
  "/promotion/subscription/checkout",
  createPromotionSubscriptionCheckout,
);

router.get(
  "/promotion/subscription/session/:sessionId",
  getPromotionSubscriptionFromSession,
);

router.post("/promotion/subscription/cancel", cancelPromotionSubscription);

module.exports = router;
