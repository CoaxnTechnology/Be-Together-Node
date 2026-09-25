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
      // Required unless this payment came from a Service Request booking
      // instead (see `serviceRequest`) — existing Service payments are
      // unaffected since they never set `serviceRequest`.
      required: function () {
        return !this.serviceRequest;
      },
    },
    // ⭐ Set instead of `service` when this payment was created from the
    // Service Request flow (paid_fixed / paid_offer).
    serviceRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
      default: null,
    },
    // Set only for paid_offer bookings — the specific accepted Offer this
    // payment was created for (kept for traceability/history).
    serviceRequestOffer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequestOffer",
      default: null,
    },
    contactPhone: { type: String },
    location_name: { type: String, default: null },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: null,
      },
    },
    bookingId: { type: String, required: false },
    checkoutSessionId: { type: String, required: true },

    paymentIntentId: { type: String, default: null },
    customerStripeId: { type: String, required: true },
    providerStripeId: { type: String, required: true },
    amount: { type: Number, required: true },

    appCommission: { type: Number, default: 0 },
    providerAmount: { type: Number, default: 0 },
    providerCommissionPercentage: {
      type: Number,
      default: 0,
    },

    customerCommissionPercentage: {
      type: Number,
      default: 0,
    },

    providerCommissionAmount: {
      type: Number,
      default: 0,
    },

    customerCommissionAmount: {
      type: Number,
      default: 0,
    },

    totalPaidByCustomer: {
      type: Number,
      default: 0,
    },
    walletCoinsUsed: {
      type: Number,
      default: 0,
    },

    walletAmountUsed: {
      type: Number,
      default: 0,
    },

    customerPaidAmount: {
      type: Number,
      default: 0,
    },

    platformContribution: {
      type: Number,
      default: 0,
    },

    originalAmount: {
      type: Number,
      default: 0,
    },

    usedWallet: {
      type: Boolean,
      default: false,
    },
    currency: { type: String, default: null },
    transferStatus: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: null,
    },
    transferAmount: {
      type: Number,
      default: 0,
    },
    transferDestination: {
      type: String,
      default: null,
    },
    transferCreatedAt: {
      type: Date,
      default: null,
    },

    transferId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "held", "failed", "refunded", "canceled"],
      default: "pending",
    },
    captureStatus: {
      type: String,
      default: null,
    },
    capturedAt: {
      type: Date,
      default: null,
    },
    refundId: { type: String, default: null },
    refundReason: { type: String, default: null },
    completedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundStatus: {
      type: String,
      default: null,
    },

    refundedAmount: {
      type: Number,
      default: 0,
    },

    cancellationFee: {
      type: Number,
      default: 0,
    },
    heldAt: {
      type: Date,
      default: null,
    },
    platformRetainedAmount: {
      type: Number,
      default: 0,
    },

    transferFailureReason: {
      type: String,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    transferFailureCode: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);
//

module.exports = mongoose.model("Payment", paymentSchema);
//
