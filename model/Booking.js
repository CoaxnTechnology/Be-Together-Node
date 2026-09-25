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
    cancelledBy: String,
    cancelReason: String,
    cancellationFee: Number,
    refundAmount: Number,
  },

  { timestamps: true },
);
module.exports = mongoose.model("Booking", bookingSchema);
