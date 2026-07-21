const express = require("express");

const router = express.Router();

const { getReferralDashboard } = require("../controller/referralController");

const auth = require("../Middleware/authMiddleware");

router.get("/dashboard", auth, getReferralDashboard);

module.exports = router;
