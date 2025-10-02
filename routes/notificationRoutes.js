const express = require("express");
const router = express.Router();
const { sendTestNotification } = require("../controller/notificationController");

// POST /api/notifications/test
router.post("/test", sendTestNotification);

module.exports = router;
