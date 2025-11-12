const express = require("express");
const router = express.Router();
const stripeConnectController = require("../controller/stripeConnectController");

router.post("/create-account", stripeConnectController.createConnectedAccount);
router.get("/account/:userId", stripeConnectController.getConnectedAccount);
router.post("/login-link", stripeConnectController.createLoginLink);
router.post("/create-customer", stripeConnectController.createStripeCustomer);
router.post("/onboarding-link", stripeConnectController.createOnboardingLink);


module.exports = router;
