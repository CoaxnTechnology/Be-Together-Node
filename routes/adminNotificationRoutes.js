const express = require("express");
const router = express.Router();

const {
  getSummary,
  listNotifications,
  markRead,
} = require("../controller/adminNotificationController");
const adminMiddleware = require("../Middleware/adminAuth");

router.get("/summary", adminMiddleware, getSummary);
router.get("/", adminMiddleware, listNotifications);
router.post("/mark-read", adminMiddleware, markRead);

module.exports = router;
