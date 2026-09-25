const mongoose = require("mongoose");

// Post-booking price revision for a "paid_offer" Service Request booking —
// the only mechanism for when the real job turns out different on-site
// (client-finalized 24 Sep 2026). No visit/inspection fee exists anywhere;
// this is the single adjustment tool, and it only ever runs on an already
// confirmed+paid Booking.
const quotationChangeSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    previousAmount: { type: Number, required: true },
    proposedAmount: { type: Number, required: true },
    // Required per the client's risk-mitigation decision — every price
    // change must be explained in writing.
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("QuotationChange", quotationChangeSchema);
