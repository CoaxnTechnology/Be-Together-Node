const mongoose = require("mongoose");

const pendingAmbassadorAssignmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    ambassadorType: {
      type: String,
      enum: ["standard", "exclusive"],
      required: true,
    },

    commissionRate: {
      type: Number,
      required: true,
    },

    parentAmbassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    territories: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Territory",
  },
],

    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "cancelled"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "PendingAmbassadorAssignment",
  pendingAmbassadorAssignmentSchema,
);
