const express = require("express");
const router = express.Router();
const { optionalAuth } = require("../Middleware/optionalAuth");
const homeFeedController = require("../controller/homeFeedController");

// Guests get the same nearby mix (no personalization/live-demand/account
// notice, since those need a logged-in identity) — same optionalAuth pattern
// already used by /service/get and /service-requests/list.
router.get("/highlights", optionalAuth, homeFeedController.getHomeHighlights);

module.exports = router;
