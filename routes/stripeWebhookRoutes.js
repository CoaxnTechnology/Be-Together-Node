const express = require("express");
const router = express.Router();
const stripeWebhookController = require("../controller/stripeWebhookController");

router.post(
  "/",
  express.raw({ type: "application/json" }),
  stripeWebhookController.handleWebhook
);

module.exports = router;
