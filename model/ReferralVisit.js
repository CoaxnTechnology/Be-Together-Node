const mongoose = require("mongoose");

const referralVisitSchema =
  new mongoose.Schema({

    referralCode: String,

    deviceId: String,

    ipAddress: String,

    created_at: {
      type: Date,
      default: Date.now,
    },

  });

module.exports =
  mongoose.model(
    "ReferralVisit",
    referralVisitSchema
  );