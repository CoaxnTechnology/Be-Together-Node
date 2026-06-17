const mongoose = require("mongoose");

const ambassadorWalletHistorySchema = new mongoose.Schema(
  {
    ambassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    transactionType: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["commission_earned", "withdrawal", "adjustment", "refund"],
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },

    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    // ===========================
    // COMMISSION TRACKING
    // ===========================

    commissionSource: {
      type: String,
      enum: ["customer_side", "provider_side", "territorial"],
      default: null,
      index: true,
    },

    commissionRate: {
      type: Number,
      default: 0,
    },

    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    territory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Territory",
      default: null,
    },

    // ===========================
    // BOOKING RELATIONS
    // ===========================

    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    },

    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      default: null,
    },

    // ===========================
    // PAYOUT / WITHDRAWAL
    // ===========================

    stripeTransferId: {
      type: String,
      default: null,
      index: true,
    },

    // ===========================
    // NOTES
    // ===========================

    note: {
      type: String,
      maxlength: 500,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

// Fast ambassador history lookup
ambassadorWalletHistorySchema.index({
  ambassador: 1,
  createdAt: -1,
});
ambassadorWalletHistorySchema.index(
  {
    booking: 1,
    ambassador: 1,
    commissionSource: 1,
    type: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      type: "commission_earned",
    },
  },
);
module.exports = mongoose.model(
  "AmbassadorWalletHistory",
  ambassadorWalletHistorySchema,
);
