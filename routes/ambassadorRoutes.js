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
  assignParentAmbassador,
  dashboard,
  walletHistory,
  getAmbassadorById,
  getAmbassadorWalletHistory,
  getAmbassadorAnalytics,
  withdrawAmount,
  getMyWallet,
} = require("../controller/ambassadorController");
// USER

router.post("/apply", auth, applyForAmbassador);

router.get("/my-application", auth, getMyApplication);
router.get("/dashboard", auth, dashboard);
router.get("/wallet-history", auth, walletHistory);
router.get("/wallet", auth, getMyWallet);
// ADMIN

router.post("/admin/approve/:applicationId", adminAuth, approveApplication);

router.post("/admin/reject/:applicationId", adminAuth, rejectApplication);

router.post("/admin/make-ambassador/:userId", adminAuth, makeAmbassador);
router.post(
  "/admin/assign-parent-ambassador/:userId",
  adminAuth,
  assignParentAmbassador,
);

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
// =====================================
// ADMIN AMBASSADOR DETAILS
// =====================================

router.get("/admin/:id", adminAuth, getAmbassadorById);
// =====================================
// WITHDRAWAL
// =====================================

router.post("/withdraw", auth, withdrawAmount);


// =====================================
// ADMIN WALLET HISTORY
// =====================================

router.get("/admin/:id/wallet-history", adminAuth, getAmbassadorWalletHistory);

// =====================================
// ADMIN ANALYTICS
// =====================================

console.log("Ambassador analytics route registered: GET /admin/:id/analytics");
router.get("/admin/:id/analytics", adminAuth, getAmbassadorAnalytics);
router.post("/verify-user-otp", auth, verifyUserOtpByAmbassador);

module.exports = router;
