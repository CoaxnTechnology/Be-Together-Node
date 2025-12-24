// models/Admin.js
const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema(
  {
    // ================= BASIC INFO =================

    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    mobile: {
      type: String,
      default: null,
    },

    hashed_password: {
      type: String,
      required: true,
    },

    is_active: {
      type: Boolean,
      default: true,
    },

    // ================= EMAIL OTP (UPDATE EMAIL) =================
    otp_code: {
      type: String,
      default: null,
    },

    otp_expiry: {
      type: Date,
      default: null,
    },

    temp_email: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },

    // ================= SUPPORT SETTINGS (ADMIN PANEL) =================
    supportPhone: {
      type: String,
      default: "+91 98765 43210",
    },

    supportEmail: {
      type: String,
      default: "support@betogether.com",
    },

    supportTime: {
      type: String,
      default: "Mon–Sat, 10 AM – 7 PM",
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

module.exports = mongoose.model("Admin", adminSchema);
