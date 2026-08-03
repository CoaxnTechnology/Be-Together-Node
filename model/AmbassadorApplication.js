const mongoose = require("mongoose");

const ambassadorApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // =====================================
    // APPLICATION TYPE
    // =====================================

    applicationType: {
  type: String,
  enum: [
    "self",
    "admin_invitation",
    "exclusive_invitation",
  ],
  required: true,
},

    createdByUser: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  default: null,
},
createdByAdmin: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Admin",
  default: null,
},
    sourceAssignment: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "PendingAmbassadorAssignment",
  default: null,
},

    // =====================================
    // SELF APPLICATION FIELDS
    // =====================================

    name: {
      type: String,
      trim: true,
      required: function () {
        return this.applicationType === "self";
      },
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: function () {
        return this.applicationType === "self";
      },
    },

    phoneNumber: {
      type: String,
      trim: true,
      required: function () {
        return this.applicationType === "self";
      },
    },

    city: {
      type: String,
      trim: true,
      required: function () {
        return this.applicationType === "self";
      },
    },

    // =====================================
    // OPTIONAL FIELDS
    // =====================================

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
      default: false,
      required: function () {
        return this.applicationType === "self";
      },
    },

    // =====================================
    // STATUS
    // =====================================

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
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

    rejectionCooldownUntil: {
      type: Date,
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
  }
);

// =====================================
// UPDATE TIMESTAMP
// =====================================

ambassadorApplicationSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model(
  "AmbassadorApplication",
  ambassadorApplicationSchema
);
