const mongoose = require("mongoose");

const ambassadorApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Required Fields
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      trim: true,
    },

    // Optional Fields
    profession: {
      type: String,
      default: null,
    },

    targetAudience: {
      type: String,
      default: null,
    },

    whyBecomeAmbassador: {
      type: String,
      default: null,
    },

    howPromoteBetogether: {
      type: String,
      default: null,
    },

    socialMediaUrls: {
      type: [String],
      default: [],
    },

    acceptedAgreement: {
      type: Boolean,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "canceld"],
      default: "pending",
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    rejectionReason: {
      type: String,
      default: null,
    },

    created_at: {
      type: Date,
      default: Date.now,
    },

    updated_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

ambassadorApplicationSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model(
  "AmbassadorApplication",
  ambassadorApplicationSchema,
);
