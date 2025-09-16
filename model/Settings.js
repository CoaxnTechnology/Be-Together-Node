// models/Settings.js
const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: null },
  value: { type: mongoose.Schema.Types.Mixed } // store JSON or any type

}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

module.exports = mongoose.model("Settings", settingsSchema);
