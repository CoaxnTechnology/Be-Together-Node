// models/Invoice.js
const mongoose = require("mongoose");
const invoiceSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  bookingId: { type: String, required: true },
  commission_due: { type: Number, required: true },
  penalty_due: { type: Number, required: true },
  total_due: { type: Number, required: true },
  offense_number: { type: Number, default: 1 }, // 1 = first offense
  status: { type: String, enum: ["unpaid","paid","canceled"], default: "unpaid" },
  paymentIntentId: { type: String, default: null }, // if paid via Stripe
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("Invoice", invoiceSchema);
