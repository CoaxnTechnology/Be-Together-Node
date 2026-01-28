const express = require("express");
const { createPromotionSubscription } = require("../controller/promotionSubscription.controller");
const router = express.Router();
router.post(
  "/promotion/create-subscription",
  createPromotionSubscription
);

module.exports = router;