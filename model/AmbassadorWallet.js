const mongoose = require("mongoose");

const ambassadorWalletSchema = new mongoose.Schema({
  ambassador: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    unique: true,
    required: true,
  },
  balance: {
    type: Number,
    default: 0,
  },
  totalEarned: {
    type: Number,
    default: 0,
  },

  totalWithdrawn: {
    type: Number,
    default: 0,
  },

  created_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("AmbassadorWallet", ambassadorWalletSchema);
