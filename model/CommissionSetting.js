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

  // Service Request bookings whose provider chose the "late_fee" policy and
  // the customer cancels less than 1 hour before the start:
  // % of the service amount kept from the customer's refund
  // (e.g. 30 → on a €100 booking the customer gets €70 back)…
  requestLateCancellationPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  // …and BeTogether's % of that kept amount; the rest goes to the provider
  // (e.g. 10 → of the €30, BeTogether keeps €3, provider gets €27).
  requestLateCancellationAdminSharePercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
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
