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
    // Optional — the provider can explain the price, but an offer at the
    // customer's own budget needs no explanation.
    note: { type: String, default: null, trim: true },
    // Chosen by the provider when sending the offer, shown to the customer
    // before they accept, and frozen onto the Booking once accepted:
    // - late_fee: free cancellation until 1 hour before the start time,
    //   after that the admin-set late cancellation fee applies.
    // - free: the customer can cancel any time with a full refund.
    cancellationPolicy: {
      type: String,
      enum: ["late_fee", "free"],
      default: "late_fee",
    },
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
