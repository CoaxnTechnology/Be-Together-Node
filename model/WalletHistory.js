const mongoose = require("mongoose");

const walletHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  points: Number,

  type: {
    type: String,
    enum: [
      "referral_booking_bonus",
      "referral_service_bonus",
    ],
  },

  referralUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service",
    default: null,
  },

  note: String,

  created_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports =
  mongoose.model(
    "WalletHistory",
    walletHistorySchema
  );