const mongoose = require("mongoose");

const walletHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,

    ref: "User",

    required: true,
  },

  points: {
    type: Number,

    required: true,
  },

  transactionType: {
    type: String,

    enum: ["credit", "debit"],

    required: true,
  },

  type: {
    type: String,

    enum: [
      "referral_booking_bonus",

      "referral_service_bonus",

      "wallet_spent",

      "wallet_refund",
    ],

    required: true,
  },

  referralUser: {
    type: mongoose.Schema.Types.ObjectId,

    ref: "User",

    default: null,
  },

  service: {
    type: mongoose.Schema.Types.ObjectId,

    ref: "Service",

    default: null,
  },

  note: {
    type: String,

    default: "",
  },

  created_at: {
    type: Date,

    default: Date.now,
  },
});

module.exports = mongoose.model("WalletHistory", walletHistorySchema);
