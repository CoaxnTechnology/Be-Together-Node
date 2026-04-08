const express = require("express");
const router = express.Router();

const {
  reportService,
  getReportedServices,
  approveReport,
  rejectReport,
} = require("../controller/serviceReport.controller");

// user
router.post("/report", reportService);

// admin
router.get("/reports", getReportedServices);
router.post("/approve", approveReport);
router.post("/reject", rejectReport);

module.exports = router;
