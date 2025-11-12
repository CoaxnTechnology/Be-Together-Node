const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
    bookingId: { type: String, required: true },

    paymentIntentId: { type: String, required: true },
    customerStripeId: { type: String, required: true },
    providerStripeId: { type: String, required: true },
    amount: { type: Number, required: true },
    appCommission: { type: Number, default: 0 },
    providerAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "completed", "held", "failed", "refunded", "canceled"],
      default: "pending",
    },
    refundId: { type: String, default: null },
    refundReason: { type: String, default: null },
    completedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
