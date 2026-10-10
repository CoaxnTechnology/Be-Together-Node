const express = require("express");
const router = express.Router();
const stripeConnectController = require("../controller/stripeConnectController");
const { onboardingRefresh } = require("../utils/stripeConnect");

router.post("/create-account", stripeConnectController.createConnectedAccount);
router.get("/account/:userId", stripeConnectController.getConnectedAccount);
router.post("/login-link", stripeConnectController.createLoginLink);
router.post("/create-customer", stripeConnectController.createStripeCustomer);
router.post("/onboarding-link", stripeConnectController.createOnboardingLink);
// Stripe's refresh_url: an expired/used onboarding link lands here and is
// sent straight to a fresh one.
router.get("/onboarding/refresh", onboardingRefresh);


module.exports = router;
