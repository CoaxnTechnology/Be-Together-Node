const mongoose = require("mongoose");

const commissionSchema = new mongoose.Schema({
  providerCommissionPercentage: {
    type: Number,
    default: 8,
  },

  customerCommissionPercentage: {
    type: Number,
    default: 4,
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});
module.exports = mongoose.model("CommissionSetting", commissionSchema);
