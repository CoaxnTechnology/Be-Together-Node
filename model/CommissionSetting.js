const mongoose = require("mongoose");

const commissionSchema = new mongoose.Schema({
  percentage: { type: Number, default: 20 }, // admin default
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("CommissionSetting", commissionSchema);
