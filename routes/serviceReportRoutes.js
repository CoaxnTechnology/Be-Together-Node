const express = require("express");
const router = express.Router();

const {
  reportService,
  getReportedServices,
  approveReport,
  rejectReport,
} = require("../controller/serviceReport.controller");
const authMiddleware = require("../Middleware/authMiddleware");
// user
router.post("/report", authMiddleware, reportService);

// admin
router.get("/reports", getReportedServices);
router.post("/approve", approveReport);
router.post("/reject", rejectReport);

module.exports = router;
