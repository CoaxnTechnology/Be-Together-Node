const express = require("express");

const router = express.Router();

const auth = require("../Middleware/authMiddleware");

const adminAuth = require("../Middleware/adminAuth");

const {
  applyForAmbassador,
  getMyApplication,
  approveApplication,
  rejectApplication,
  makeAmbassador,
  getAllApplications,
  getAllAmbassadors,
  removeAmbassador,
  createUserByAmbassador,
  verifyUserOtpByAmbassador,
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
router.post("/create-user", auth, createUserByAmbassador);

router.post("/verify-user-otp", auth, verifyUserOtpByAmbassador);

module.exports = router;
