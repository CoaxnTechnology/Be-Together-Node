// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    uid: { type: String, default: null }, // Google UID
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true, index: true },
    mobile: { type: String, required: true },
    hashed_password: { type: String, default: null },
    profile_image: { type: String, default: null },
    bio: { type: String, default: null },
    city: { type: String, default: null, index: true },

    register_type: {
      type: String,
      enum: ["manual", "google_auth"],
      default: "manual",
    },
    login_type: {
      type: String,
      enum: ["manual", "google_auth"],
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

    // Inline availability definition — no separate schemas
    availability: {
      type: [
        {
          day: { type: String, required: true }, // e.g. "Monday"
          times: [
            {
              start_time: { type: String, required: true }, // "09:00"
              end_time: { type: String, required: true }, // "12:00"
            },
          ],
        },
      ],
      default: [],
    },

    // Relationships / simple arrays
    languages: { type: [String], default: [] },

    // INTERESTS: store canonical category tags (strings)
    interests: { type: [String], default: [] },

    services: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],
    lastResendAt: { type: Date, default: null },

    reset_password_token: { type: String, default: null }, // store hashed token
    reset_password_expiry: { type: Date, default: null },
    reset_password_used: { type: Boolean, default: false },
    lastResetRequestAt: { type: Date, default: null }, // optional cooldown
    lastPasswordResetAt: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    last_login: { type: Date, default: null },
  },
  {
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Update updated_at automatically
userSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model("User", userSchema);
