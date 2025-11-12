// controllers/paymentViolationController.js
const CommissionSetting = require("../model/CommissionSetting");
const Invoice = require("../model/Invoice");
const Payment = require("../model/Payment");
const User = require("../model/User");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// helper: count active offenses for provider (non-canceled invoices)
async function getOffenseCount(providerId) {
  const count = await Invoice.countDocuments({ provider: providerId, status: { $ne: "canceled" } });
  return count; // 0 means first offense will be count 0 before creating
}

// compute penalty and action by offense index
function computePenalty(offenseIndex, basePenalty) {
  // offenseIndex = number of previous offenses
  if (offenseIndex === 0) return { penalty: basePenalty, action: "warn" }; // 1st
  if (offenseIndex === 1) return { penalty: basePenalty * 2, action: "temporary_block" }; // 2nd
  return { penalty: basePenalty * 5, action: "suspend" }; // 3rd or more
}

// auto flag: call when booking_status = completed but no successful payment
exports.autoFlagViolation = async (req, res) => {
  try {
    const { bookingId, providerId, amount } = req.body;
    // if payment exists and completed → nothing to do
    const existingPayment = await Payment.findOne({ bookingId });
    if (existingPayment && existingPayment.status === "completed") {
      return res.json({ success: true, message: "Payment exists" });
    }

    // compute commission and penalty
    const commissionSetting = await CommissionSetting.findOne();
    const commissionPercent = commissionSetting?.percentage ?? 20;
    const commissionDue = Math.round((amount * commissionPercent) / 100 * 100) / 100;

    const previousOffenses = await getOffenseCount(providerId);
    const basePenalty = Number(process.env.DEFAULT_PENALTY || 20);
    const { penalty, action } = computePenalty(previousOffenses, basePenalty);
    const totalDue = Math.round((commissionDue + penalty) * 100) / 100;

    // create invoice
    const invoice = await Invoice.create({
      provider: providerId,
      bookingId,
      commission_due: commissionDue,
      penalty_due: penalty,
      total_due: totalDue,
      offense_number: previousOffenses + 1,
      status: "unpaid"
    });

    // apply restriction
    if (action === "warn") {
      // just restrict new listings but let them continue maybe
      await User.findByIdAndUpdate(providerId, { status: "restricted" });
    } else if (action === "temporary_block") {
      // restrict and optionally set blockedUntil (not implemented here)
      await User.findByIdAndUpdate(providerId, { status: "restricted" });
    } else {
      // suspend
      await User.findByIdAndUpdate(providerId, { status: "banned" });
    }

    // TODO: send notification / email to provider

    return res.json({ success: true, message: "Invoice created", data: invoice, action });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// provider pays invoice via Stripe (checkout flow already implemented on front)
exports.payInvoice = async (req, res) => {
  try {
    const { invoiceId, providerId, paymentMethodId } = req.body;
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const provider = await User.findById(providerId);
    if (!provider) return res.status(404).json({ message: "Provider not found" });

    // create payment intent (immediate capture)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(invoice.total_due * 100),
      currency: "eur",
      customer: provider.stripeCustomerId || undefined,
      payment_method: paymentMethodId,
      confirm: true,
      description: `Invoice ${invoice._id} for booking ${invoice.bookingId}`
    });

    invoice.status = "paid";
    invoice.paymentIntentId = paymentIntent.id;
    await invoice.save();

    // lift restriction
    await User.findByIdAndUpdate(providerId, { status: "active" });

    return res.json({ success: true, message: "Invoice paid and restriction lifted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// admin reviews appeal
exports.reviewAppeal = async (req, res) => {
  try {
    const { invoiceId, action } = req.body; // action: "approve" | "reject"
    const inv = await Invoice.findById(invoiceId);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });

    if (action === "approve") {
      inv.status = "canceled";
      await inv.save();
      await User.findByIdAndUpdate(inv.provider, { status: "active" });
      return res.json({ success: true, message: "Appeal approved, invoice canceled" });
    } else if (action === "reject") {
      // keep invoice unpaid -> provider must pay
      return res.json({ success: true, message: "Appeal rejected" });
    } else {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
