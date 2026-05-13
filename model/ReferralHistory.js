const mongoose = require("mongoose");

const referralHistorySchema =
  new mongoose.Schema({

    referrer: {
      type:
        mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    referredUser: {
      type:
        mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    referralCode: {
      type: String,
      default: null,
    },

    rewardAmount: {
      type: Number,
      default: 0,
    },

    rewardType: {
      type: String,
      enum: [
        "signup",
        "booking",
        "service_create",
      ],
      default: "signup",
    },

    status: {
      type: String,
      enum: [
        "pending",
        "completed",
      ],
      default: "completed",
    },

    created_at: {
      type: Date,
      default: Date.now,
    },

});

module.exports =
 mongoose.model(
   "ReferralHistory",
   referralHistorySchema
 );