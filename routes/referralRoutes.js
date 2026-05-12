const express = require("express");

const router = express.Router();

const {
  openReferralLink,
} = require("../controller/referralController");

router.get(
  "/r/:code",
  openReferralLink
);

module.exports = router;