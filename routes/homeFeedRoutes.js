const express = require("express");
const router = express.Router();
const authMiddleware = require("../Middleware/authMiddleware");
const homeFeedController = require("../controller/homeFeedController");

router.get("/highlights", authMiddleware, homeFeedController.getHomeHighlights);

module.exports = router;
