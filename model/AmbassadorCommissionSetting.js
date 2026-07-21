const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["percentage", "fixed"],
    default: "percentage",
  },

  value: {
    type: Number,
    default: 5,
  },

  isActive: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model(
  "AmbassadorCommissionSetting",
  schema
);