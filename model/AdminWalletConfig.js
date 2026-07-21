const mongoose = require("mongoose");

const adminWalletConfigSchema = new mongoose.Schema({
  // ======================
  // REFERRAL BONUS
  // ======================

  inviterReward: {
    type: Number,

    default: 50,
  },

  invitedReward: {
    type: Number,

    default: 20,
  },

  // ======================
  // WALLET CONFIG
  // ======================

  maxWalletUsagePercent: {
    type: Number,

    default: 20,
  },

  coinToCurrencyValue: {
    type: Number,

    default: 1,
  },

  currency: {
    type: String,

    default: "EUR",
  },

  created_at: {
    type: Date,

    default: Date.now,
  },

  updated_at: {
    type: Date,

    default: Date.now,
  },
});

adminWalletConfigSchema.pre("save", function (next) {
  this.updated_at = new Date();

  next();
});

module.exports = mongoose.model("AdminWalletConfig", adminWalletConfigSchema);
