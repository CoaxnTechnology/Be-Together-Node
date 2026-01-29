const express = require("express");
const router = express.Router();

const {
  createPromotionSubscriptionCheckout,
  getPromotionSubscriptionFromSession,
  cancelPromotionSubscription,
} = require("../controller/promotionSubscription.controller");

router.post(
  "/subscription/checkout",
  createPromotionSubscriptionCheckout,
);

router.get(
  "/subscription/session/:sessionId",
  getPromotionSubscriptionFromSession,
);

router.post("/subscription/cancel", cancelPromotionSubscription);

module.exports = router;
