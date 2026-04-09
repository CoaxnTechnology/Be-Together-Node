const express = require("express");
const router = express.Router();

const {
  reportService,
  getReportedServices,
  approveReport,
  rejectReport,
} = require("../controller/serviceReport.controller");
const authMiddleware = require("../Middleware/authMiddleware");
const adminMiddleware = require("../Middleware/adminAuth");
// user
router.post("/report", authMiddleware, reportService);

// admin
router.get("/reports", adminMiddleware, getReportedServices);
router.post("/approve", adminMiddleware, approveReport);
router.post("/reject", adminMiddleware, rejectReport);

module.exports = router;
