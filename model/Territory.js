const mongoose = require("mongoose");

const territorySchema = new mongoose.Schema(
  {
    city: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    country: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    exclusiveAmbassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    active: {
      type: Boolean,
      default: true,
    },

    kpiTarget: {
      type: Number,
      default: 400,
    },

    completedServicesLast6Months: {
      type: Number,
      default: 0,
    },

    assignedAt: {
      type: Date,
      default: null,
    },

    reviewDueAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// One territory per city + country
territorySchema.index(
  {
    city: 1,
    country: 1,
  },
  {
    unique: true,
  },
);

module.exports = mongoose.model("Territory", territorySchema);
