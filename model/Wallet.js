const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    unique: true,
    required: true,
  },

  points: {
    type: Number,
    default: 0,
  },

  totalEarned: {
    type: Number,
    default: 0,
  },

  totalSpent: {
    type: Number,
    default: 0,
  },

  created_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Wallet", walletSchema);