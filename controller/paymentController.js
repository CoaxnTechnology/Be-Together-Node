const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Payment = require("../model/Payment");
const CommissionSetting = require("../model/CommissionSetting");
const User = require("../model/User");
const CancellationSetting = require("../model/CancellationSetting");
// Create a new online payment
exports.createStripePayment = async (req, res) => {
  try {
    const {
      userId,
      providerId,
      serviceId,
      bookingId,
      amount,
      paymentMethodId,
    } = req.body;
    const commissionSetting = await CommissionSetting.findOne();
    const commissionPercent = commissionSetting?.percentage || 20;

    const commission = Math.round((amount * commissionPercent) / 100);
    const providerAmount = amount - commission;

    const provider = await User.findById(providerId);
    const customer = await User.findById(userId);
    if (!provider?.stripeAccountId || !customer?.stripeCustomerId) {
      return res
        .status(400)
        .json({ message: "Stripe account/customer missing" });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: "inr",
      customer: customer.stripeCustomerId,
      payment_method: paymentMethodId,
      confirm: true,

      capture_method: "manual",
      application_fee_amount: commission * 100, // platform commission
      transfer_data: {
        destination: provider.stripeAccountId, // provider payout destination
      },
      description: `Booking ${bookingId} - Service ${serviceId}`,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });
    const payment = await Payment.create({
      user: userId,
      provider: providerId,
      service: serviceId,
      amount,
      bookingId,
      appCommission: commission,
      providerAmount,
      paymentIntentId: paymentIntent.id,
      customerStripeId: customer.stripeCustomerId,
      providerStripeId: provider.stripeAccountId,
      status: "pending",
    });

    res.status(200).json({ isSuccess: true, data: payment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Capture payment after service completion
exports.capturePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    await stripe.paymentIntents.capture(payment.paymentIntentId);
    payment.status = "completed";
    payment.completedAt = new Date();
    await payment.save();

    res.status(200).json({ message: "Payment captured successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.refundPayment = async (req, res) => {
  try {
    const { paymentId, reason } = req.body;
    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    // 🔒 Prevent double refund
    if (payment.status === "refunded")
      return res.status(400).json({ message: "Already refunded" });

    const cancellation = await CancellationSetting.findOne();
    const cancellationPercent = cancellation?.percentage || 10; // default 10%
    const deduction = (payment.amount * cancellationPercent) / 100;
    const refundAmount = Math.round((payment.amount - deduction) * 100); // in paise

    // ⚙️ Case 1: Payment captured (service booked)
    if (payment.status === "completed") {
      const refund = await stripe.refunds.create({
        payment_intent: payment.paymentIntentId,
        amount: refundAmount, // partial refund (after deduction)
      });

      payment.status = "refunded";
      payment.refundId = refund.id;
      payment.refundReason =
        reason || `Cancelled. ${cancellationPercent}% fee.`;
      payment.refundedAt = new Date();
      await payment.save();

      return res.json({
        success: true,
        message: `Refund issued (commission ${cancellationPercent}% kept).`,
        data: refund,
      });
    }

    // ⚙️ Case 2: Payment pending (not captured yet)
    if (payment.status === "pending") {
      // cancel payment intent
      await stripe.paymentIntents.cancel(payment.paymentIntentId);

      // update DB manually
      payment.status = "refunded";
      payment.refundedAt = new Date();
      payment.refundReason = `Canceled before capture. ${cancellationPercent}% kept.`;
      payment.appCommission = deduction;
      payment.providerAmount = 0;
      await payment.save();

      return res.json({
        success: true,
        message: `Booking canceled. ${cancellationPercent}% cancellation fee applied.`,
      });
    }

    res.status(400).json({ message: "Refund not possible for this status" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
