const mongoose = require("mongoose");

const serviceReportSchema = new mongoose.Schema(
  {
    // ⭐ "service" (existing/default) = reporting a Service listing;
    // "user" (new) = reporting a User — no-show, harassment, fraud, etc.
    // Kept in ONE model/collection/admin-page rather than a separate system.
    type: {
      type: String,
      enum: ["service", "user"],
      default: "service",
    },

    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      // Required only for a "service" report — existing calls never send
      // `type`, so they default to "service" and behave exactly as before.
      required: function () {
        return this.type === "service";
      },
    },

    // Only set when type === "user"
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },
    // Only meaningful when type === "user" — auto "urgent" for
    // harassment/inappropriate_request, else "standard".
    severity: {
      type: String,
      enum: ["standard", "urgent"],
      default: "standard",
    },
    evidence: { type: [String], default: [] },

    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 🔥 REMOVE enum → allow any value
    // For a "user" report this holds the category (no_show/harassment/
    // inappropriate_request/fraud/other); for a "service" report it's the
    // existing free-text reason.
    reason: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "resolved", "dismissed"],
      default: "pending",
    },
    // Only meaningful when type === "user" — what the admin actually did.
    adminAction: {
      type: String,
      enum: ["none", "warned", "refunded", "restricted", "blocked", "dismissed"],
      default: "none",
    },
    adminNotes: { type: String, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ServiceReport", serviceReportSchema);
