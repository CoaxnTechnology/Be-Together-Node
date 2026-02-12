const mongoose = require("mongoose");

const promotionPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    days: {
      type: Number,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    description: {
      type: String, // ✅ ADD THIS
    },
    stripePriceId: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PromotionPlan", promotionPlanSchema);
