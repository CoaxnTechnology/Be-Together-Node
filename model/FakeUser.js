// models/FakeUser.js
const mongoose = require("mongoose");

const fakeUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, index: true },
  city: { type: String, required: true },
  target_audience: { type: String, default: null },
  status: { type: String, enum: ["active", "inactive", "banned"], default: "active" },

  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model("FakeUser", fakeUserSchema);
