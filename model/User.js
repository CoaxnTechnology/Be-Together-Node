// models/User.js
const mongoose = require("mongoose");
const PointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    // GeoJSON order: [longitude, latitude]
    coordinates: { type: [Number], default: [0, 0] },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    uid: { type: String, default: null }, // Google UID
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true, index: true },
    mobile: { type: String, required: false },
    hashed_password: { type: String, default: null },
    profile_image: { type: String, default: null },
    bio: { type: String, default: null },
    city: { type: String, default: null, index: true },
    age: { type: Number, default: null },
    is_fake: { type: Boolean, default: false },

    register_type: {
      type: String,
      enum: ["manual", "google_auth", "apple_auth"],
      default: "manual",
    },
    login_type: {
      type: String,
      enum: ["manual", "google_auth", "apple_auth"],
      default: "manual",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "banned"],
      default: "active",
    },
    is_active: { type: Boolean, default: true },

    otp_code: { type: String, default: null },
    otp_expiry: { type: Date, default: null },
    otp_verified: { type: Boolean, default: false },
    is_google_auth: { type: Boolean, default: false },

    access_token: { type: String, default: null },
    session_id: { type: String, default: null },
    fcmToken: { type: [String], default: [] },

    // Inline availability definition — no separate schemas

    // Relationships / simple arrays
    languages: { type: [String], default: [] },

    // INTERESTS: store canonical category tags (strings)
    interests: { type: [String], default: [] },
    offeredTags: { type: [String], default: [] },
    currency: { type: String, default: "EUR" },
    country: {
      type: String,
      default: null,
    },
    // GDPR Compliance
    termsAccepted: {
      type: Boolean,
      default: false,
    },

    privacyAccepted: {
      type: Boolean,
      default: false,
    },

    accepted_at: {
      type: Date,
      default: null,
    },

    ip_address: {
      type: String,
      default: null,
    },

    cookie_preferences: {
      type: String,
      default: null,
    },
    provider_uid: {
      type: String,
      default: null,
      index: true,
    },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    services: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],
    lastResendAt: { type: Date, default: null },
    lastLocation: {
      coords: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number], default: [0, 0] }, // GeoJSON order: [lon, lat]
      },
      accuracy: { type: Number, default: null },
      provider: { type: String, default: null },
      recordedAt: { type: Date, default: null },
      updatedAt: { type: Date, default: Date.now },
    },
    isAmbassador: {
      type: Boolean,
      default: false,
    },

    ambassadorStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "disabled"],
      default: null,
    },

    ambassadorApprovedAt: {
      type: Date,
      default: null,
    },

    ambassadorApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    registeredByAmbassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    registeredByAmbassadorAt: {
      type: Date,
      default: null,
    },
    // =====================================
    // AMBASSADOR SYSTEM
    // =====================================
    registeredAfterAmbassadorApproval: {
      type: Boolean,
      default: false,
    },
    ambassadorType: {
      type: String,
      enum: ["standard", "exclusive"],
      default: null,
    },

    commissionRate: {
      type: Number,
      default: 3, // 3% initially
    },

    completedPaidServices: {
      type: Number,
      default: 0,
    },

    parentAmbassador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    territory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Territory",
      default: null,
    },
    ambassadorAgreementAccepted: {
      type: Boolean,
      default: false,
    },

    ambassadorAgreementAcceptedAt: {
      type: Date,
      default: null,
    },
    ambassadorReviewDueAt: {
      type: Date,
      default: null,
    },
    ambassadorCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
    },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    ambassadorUserAgreementAccepted: {
      type: Boolean,
      default: false,
    },

    ambassadorUserAgreementAcceptedAt: {
      type: Date,
      default: null,
    },

    totalReferralUsers: {
      type: Number,
      default: 0,
    },

    totalReferralEarned: {
      type: Number,
      default: 0,
    },
    referralRewardProcessed: {
      type: Boolean,
      default: false,
    },
    pendingAmbassadorInvitation: {
      invitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      invitedAt: {
        type: Date,
        default: null,
      },
      invitationStatus: {
        type: String,
        enum: ["pending", "accepted", "declined"],
        default: "pending",
      },
    },
    stripeCustomerId: { type: String, default: null },
    stripeAccountId: { type: String, default: null },
    performancePoints: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    successfulBookings: { type: Number, default: 0 },
    restrictionOnNewServiceUntil: { type: Date, default: null },
    reset_password_token: { type: String, default: null }, // store hashed token
    reset_password_expiry: { type: Date, default: null },
    reset_password_used: { type: Boolean, default: false },
    lastResetRequestAt: { type: Date, default: null }, // optional cooldown
    lastPasswordResetAt: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    last_login: { type: Date, default: null },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    passwordChangedByUser: {
      type: Boolean,
      default: false,
    },
  },
  {
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Update updated_at automatically
userSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

userSchema.methods.addFcmToken = async function (token) {
  if (!token || typeof token !== "string") return;

  // Ensure fcmToken is always an array
  this.fcmToken = Array.isArray(this.fcmToken) ? this.fcmToken : [];

  if (!this.fcmToken.includes(token)) {
    this.fcmToken.push(token);
    await this.save();
  }
};
// ✅ Add geospatial index here
userSchema.index({ "lastLocation.coords": "2dsphere" });
// referral lookup index
userSchema.index({
  referredBy: 1,
});
module.exports = mongoose.model("User", userSchema);
