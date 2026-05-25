const mongoose = require("mongoose");

const referralTrackingSchema = new mongoose.Schema({
  referralCode: {
    type: String,
    required: true,
  },

  referralOwner: {
    type: mongoose.Schema.Types.ObjectId,

    ref: "User",

    required: true,
  },

  joinedUser: {
    type: mongoose.Schema.Types.ObjectId,

    ref: "User",

    default: null,
  },

  deviceId: {
    type: String,
    default: null,
  },

  ipAddress: {
    type: String,
    default: null,
  },

  joined: {
    type: Boolean,
    default: false,
  },

  firstBookingDone: {
    type: Boolean,
    default: false,
  },

  firstServiceCreated: {
    type: Boolean,
    default: false,
  },

  bookingBonus: {
    type: Number,
    default: 0,
  },

  serviceBonus: {
    type: Number,
    default: 0,
  },

  totalEarned: {
    type: Number,
    default: 0,
  },

  joined_at: {
    type: Date,
    default: null,
  },

  created_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ReferralTracking", referralTrackingSchema);
