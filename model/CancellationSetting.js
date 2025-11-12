const mongoose = require("mongoose");

const cancellationSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },  // Yes/No
  percentage: { type: Number, default: 0 },    // Example: 10%
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("CancellationSetting", cancellationSchema);
