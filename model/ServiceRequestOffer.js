const mongoose = require("mongoose");

// A single provider's priced Offer against a "paid_offer" ServiceRequest.
// Multiple providers can each have their own Offer on the same request —
// the request owner Accepts one (or, for `numberOfParticipants > 1`, a few).
const serviceRequestOfferSchema = new mongoose.Schema(
  {
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
      required: true,
      index: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: null },
    // Required per the client's risk-mitigation decision (24 Sep 2026) —
    // every Offer must explain the price so the customer (and admin, if
    // disputed) has something concrete to judge.
    note: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "withdrawn"],
      default: "pending",
    },
  },
  { timestamps: true },
);

// A provider should only have one active (pending) Offer per request.
serviceRequestOfferSchema.index({ request: 1, provider: 1 });

module.exports = mongoose.model("ServiceRequestOffer", serviceRequestOfferSchema);
