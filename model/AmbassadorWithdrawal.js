mongoose = require("mongoose");

const ambassadorWithdrawalSchema = new mongoose.Schema(
  {
    ambassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AmbassadorWallet",
      required: true,
    },

    // ==========================
    // Amount
    // ==========================

    requestedAmount: {
      type: Number,
      required: true,
    },

    stripeFee: {
      type: Number,
      default: 0,
    },

    finalAmount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "eur",
      lowercase: true,
    },

    // ==========================
    // Wallet Snapshot
    // ==========================

    balanceBefore: {
      type: Number,
      required: true,
    },

    balanceAfter: {
      type: Number,
      required: true,
    },

    // ==========================
    // Stripe
    // ==========================

    stripeAccountId: {
      type: String,
      default: null,
    },

    stripeTransferId: {
      type: String,
      default: null,
      index: true,
    },

    stripePayoutId: {
      type: String,
      default: null,
      index: true,
    },

    stripeBalanceTransactionId: {
      type: String,
      default: null,
    },

    // ==========================
    // Status
    // ==========================

    status: {
      type: String,
      enum: ["pending", "processing", "paid", "failed", "cancelled"],
      default: "pending",
      index: true,
    },

    // ==========================
    // Dates
    // ==========================

    requestedAt: {
      type: Date,
      default: Date.now,
    },

    processedAt: {
      type: Date,
      default: null,
    },

    arrivalDate: {
      type: Date,
      default: null,
    },

    // ==========================
    // Failure
    // ==========================

    failureReason: {
      type: String,
      default: null,
    },

    failureCode: {
      type: String,
      default: null,
    },

    failureType: {
      type: String,
      default: null,
    },

    retryCount: {
      type: Number,
      default: 0,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    // ==========================
    // Extra
    // ==========================

    note: {
      type: String,
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

ambassadorWithdrawalSchema.index({
  ambassador: 1,
  createdAt: -1,
});

ambassadorWithdrawalSchema.index({
  stripeTransferId: 1,
});

ambassadorWithdrawalSchema.index({
  stripePayoutId: 1,
});

module.exports = mongoose.model(
  "AmbassadorWithdrawal",
  ambassadorWithdrawalSchema,
);
