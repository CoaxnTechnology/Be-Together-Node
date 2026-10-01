const mongoose = require("mongoose");

// One price change on a Service Request (paid_offer) booking, proposed by the
// provider after the job started. If the customer accepts, they pay ONLY the
// difference in a separate Stripe Checkout; that charge is also listed on
// the Payment (payment.additionalCharges).
//   pending          → provider proposed, customer hasn't answered
//   awaiting_payment → customer accepted, difference not paid yet
//   accepted         → difference paid, booking total updated
//   rejected         → customer said no
//   cancelled        → dropped because the booking was cancelled first
const quotationChangeSchema = new mongoose.Schema(
  {
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    previousAmount: { type: Number, required: true },
    proposedAmount: { type: Number, required: true },
    // Required per the client's risk-mitigation decision — every price
    // change must be explained in writing.
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "awaiting_payment", "accepted", "rejected", "cancelled"],
      default: "pending",
    },
    respondedAt: { type: Date, default: null },

    // ---- The difference payment (filled in when the customer accepts) ----
    deltaAmount: { type: Number, default: 0 }, // service amount difference
    customerPayable: { type: Number, default: 0 }, // delta + customer commission
    providerCommissionAmount: { type: Number, default: 0 },
    customerCommissionAmount: { type: Number, default: 0 },
    providerAmount: { type: Number, default: 0 },
    currency: { type: String, default: null },
    checkoutSessionId: { type: String, default: null },
    paymentIntentId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    refundedAmount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

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
      // Required unless this booking came from a Service Request instead
      // (see `serviceRequest` below) — existing Service bookings are
      // unaffected since they never set `serviceRequest`.
      required: function () {
        return !this.serviceRequest;
      },
    },
    // ⭐ Set instead of `service` when this booking was created from the
    // Service Request flow (paid_fixed / paid_offer) — lets Booking History
    // label the entry as a "Request Booking" via a simple populate.
    serviceRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
      default: null,
    },
    // ⭐ NEW FIELDS
    contactPhone: { type: String, required: true }, // phone required
    location_name: { type: String, default: null },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: null,
      },
    },
    amount: { type: Number, required: true }, // current total (after price changes)
    // Service Request bookings only — the price agreed at booking time,
    // before any quotation change. amount - initialAmount = total increase.
    initialAmount: { type: Number, default: null },
    quotationChanges: { type: [quotationChangeSchema], default: [] },
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
    ambassadorCommissionProcessed: {
      type: Boolean,
      default: false,
    },

    ambassadorCommissionProcessedAt: {
      type: Date,
      default: null,
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    otp: { type: Number },
    otpExpiry: { type: Date },
    // Service Request bookings only — copied from the accepted Offer (or the
    // paid_fixed request) at payment time and never changed afterwards.
    cancellationPolicy: {
      type: String,
      enum: ["late_fee", "free", null],
      default: null,
    },
    serviceStartAt: { type: Date, default: null },
    cancelledBy: String,
    cancelReason: String,
    cancellationFee: Number,
    refundAmount: Number,
  },

  { timestamps: true },
);
module.exports = mongoose.model("Booking", bookingSchema);
