const express = require("express");
const router = express.Router();
const paymentController = require("../controller/paymentController");

router.post("/book", paymentController.bookService);

// 2️⃣ Start service → generate OTP
router.post("/start", paymentController.startService);

// 3️⃣ Verify OTP
router.post("/verify-otp", paymentController.verifyServiceOtp);

// 4️⃣ Complete service → capture payment
router.post("/complete", paymentController.completeService);

// 5️⃣ Get all bookings for a user (customer & provider)
router.get("/user/:userId", paymentController.getUserBookings);

module.exports = router;
