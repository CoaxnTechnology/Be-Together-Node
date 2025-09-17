// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
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
  availability: [
    {
      day: { type: String, required: true }, // e.g. "Monday"
      times: [
        {
          start_time: { type: String, required: true },
          end_time: { type: String, required: true },
        },
      ],
    },
  ],

  // Relationships
  languages: { type: [String], default: [] },
  interests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
  services: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  last_login: { type: Date, default: null },
});

// Update updated_at automatically
userSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model("User", userSchema);
