const mongoose = require("mongoose");
const bookingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: [
        "pending_payment",
        "booked",
        "started",
        "completed",
        "cancelled",
        "payment_failed",
      ],
      default: "pending_payment",
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    otp: { type: Number },
    otpExpiry: { type: Date },
    cancelledBy: String,
    cancelReason: String,
    cancellationFee: Number,
    refundAmount: Number,
  },
  { timestamps: true }
);
module.exports = mongoose.model("Booking", bookingSchema);
