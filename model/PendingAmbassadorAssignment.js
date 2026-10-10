const mongoose = require("mongoose");

const pendingAmbassadorAssignmentSchema = new mongoose.Schema(
  {
    // User receiving the invitation
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Who created this invitation
    assignmentSource: {
      type: String,
      enum: ["admin", "exclusive"],
      required: true,
    },

    // Admin invitation
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    // Exclusive Ambassador invitation
    createdByUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Ambassador configuration
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

    territories: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Territory",
        },
      ],
      default: [],
    },

    // Invitation status
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired"],
      required: true,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    declinedAt: {
      type: Date,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
    },

    // Set when the reminder EMAIL (day 3) went out — sent once per
    // invitation. See utils/ambassadorInvitation.js.
    reminderSentAt: {
      type: Date,
      default: null,
    },

    // How many daily reminder PUSHES have gone out (one per 24h, days 1–6).
    pushRemindersSent: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Validation
 */
pendingAmbassadorAssignmentSchema.pre("validate", function (next) {
  // Admin Invitation
  if (this.assignmentSource === "admin") {
    if (!this.createdByAdmin) {
      return next(new Error("createdByAdmin is required."));
    }

    this.createdByUser = null;
  }

  // Exclusive Ambassador Invitation
  if (this.assignmentSource === "exclusive") {
    if (!this.createdByUser) {
      return next(new Error("createdByUser is required."));
    }

    this.createdByAdmin = null;
  }

  next();
});

/**
 * One pending invitation per user
 */
pendingAmbassadorAssignmentSchema.index(
  {
    user: 1,
    status: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      status: "pending",
    },
  }
);

module.exports = mongoose.model(
  "PendingAmbassadorAssignment",
  pendingAmbassadorAssignmentSchema
);
