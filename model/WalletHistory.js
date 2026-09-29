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
      // referral reward — signup-time (utils/processReferralReward.js)
      "referral_inviter_bonus",

      "referral_invited_bonus",

      // ⭐ FIX: referral reward — milestone-based (paymentController.js's
      // free-booking branch and serviceController.js's first-service
      // check already created records with these exact strings, but they
      // were missing from this enum — every such WalletHistory.create()
      // was throwing a ValidationError, which (since neither call site
      // wraps it in a try/catch) crashed the entire booking/service-create
      // request for any user with a referrer, even though the wallet.points
      // increment just before it had already been saved. Added here rather
      // than renamed, since the schema was simply out of date.
      "referral_booking_bonus",

      "referral_service_bonus",

      // wallet usage
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
