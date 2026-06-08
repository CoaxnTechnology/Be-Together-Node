const express = require("express");

const router = express.Router();

const auth = require("../middleware/authMiddleware");

const adminAuth = require("../middleware/adminAuth");

const {
  applyForAmbassador,
  getMyApplication,
  approveApplication,
  rejectApplication,
  makeAmbassador,
  getAllApplications,
  getAllAmbassadors,
  removeAmbassador,
} = require("../controller/ambassadorController");
// USER

router.post("/apply", auth, applyForAmbassador);

router.get("/my-application", auth, getMyApplication);

// ADMIN

router.post("/admin/approve/:applicationId", adminAuth, approveApplication);

router.post("/admin/reject/:applicationId", adminAuth, rejectApplication);

router.post("/admin/make-ambassador/:userId", adminAuth, makeAmbassador);
// =====================================
// ADMIN APPLICATIONS
// =====================================

router.get("/admin/ambassador-applications", adminAuth, getAllApplications);

// =====================================
// ADMIN AMBASSADORS
// =====================================

router.get("/admin/ambassadors", adminAuth, getAllAmbassadors);

// =====================================
// REMOVE AMBASSADOR
// =====================================

router.post("/remove-ambassador/:userId", adminAuth, removeAmbassador);

module.exports = router;
