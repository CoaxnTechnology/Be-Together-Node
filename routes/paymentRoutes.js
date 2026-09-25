const express = require("express");
const router = express.Router();
const paymentController = require("../controller/paymentController");
const authMiddleware = require("../Middleware/authMiddleware");

router.post("/book", authMiddleware, paymentController.bookService);

// 2️⃣ Start service → generate OTP
router.post("/start", authMiddleware, paymentController.startService);

// 3️⃣ Verify OTP
router.post("/verify-otp", authMiddleware, paymentController.verifyServiceOtp);

// 4️⃣ Complete service → capture payment
router.post("/complete", authMiddleware, paymentController.completeService);

// 5️⃣ Get all bookings for a user (customer & provider)
router.post("/user/", authMiddleware, paymentController.getUserBookings);

router.post("/refund", authMiddleware, paymentController.refundBooking);

router.post(
  "/updateBookingStatus",authMiddleware,paymentController.updateBookingStatus,
);
router.post("/booking-preview", authMiddleware, paymentController.bookingPreview);

// ⭐ Quotation Change (client-finalized 24 Sep 2026) — the only
// post-booking price-adjustment mechanism for a "paid_offer" Service
// Request booking. No visit/inspection fee exists anywhere.
router.post(
  "/bookings/:bookingId/quotation-change",
  authMiddleware,
  paymentController.createQuotationChange,
);
router.post(
  "/bookings/:bookingId/quotation-change/:id/respond",
  authMiddleware,
  paymentController.respondToQuotationChange,
);

module.exports = router;
