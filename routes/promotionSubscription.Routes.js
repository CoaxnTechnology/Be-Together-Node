const express = require("express");
const router = express.Router();

const {
  createPromotionSubscriptionCheckout,
  confirmPromotionAfterPayment,
  cancelPromotionSubscription,
} = require("../controller/promotionSubscription.controller");

router.post(
  "/subscription/checkout",
  createPromotionSubscriptionCheckout,
);

router.post(
  "/subscription/session",
  confirmPromotionAfterPayment,
);

router.post("/subscription/cancel", cancelPromotionSubscription);

module.exports = router;
