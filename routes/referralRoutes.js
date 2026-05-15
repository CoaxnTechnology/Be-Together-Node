const express =
require("express");

const router =
express.Router();

const {
  getReferralDashboard,
} = require(
"../controller/referralController"
);

const auth =
require("../middleware/auth");

router.get(
"/dashboard",
auth,
getReferralDashboard
);

module.exports = router;