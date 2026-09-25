const mongoose = require("mongoose");

// One row per report event (submitted), read by the admin panel's sidebar
// badge/toast. Kept deliberately tiny — no per-admin read-state, since today
// there's one shared admin queue, not per-admin inboxes.
const adminNotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["service_report", "user_report"],
      required: true,
    },
    severity: { type: String, enum: ["standard", "urgent"], default: "standard" },
    message: { type: String, required: true },
    report: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceReport",
      default: null,
    },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);
