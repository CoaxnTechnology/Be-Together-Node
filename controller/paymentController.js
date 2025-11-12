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

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: "inr",
      customer: customer.stripeCustomerId,
      payment_method: paymentMethodId,
      confirm: true,
      capture_method: "manual",
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      application_fee_amount: commission * 100,
      transfer_data: { destination: provider.stripeAccountId },
      description: `Booking ${bookingId} service ${serviceId}`,
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
    const { paymentId } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const cancellation = await CancellationSetting.findOne();

    let refundAmount = payment.amount; // default full refund

    if (cancellation?.enabled && cancellation?.percentage > 0) {
      const deduction = (payment.amount * cancellation.percentage) / 100;
      refundAmount = payment.amount - deduction;
    }

    const refund = await stripe.refunds.create({
      payment_intent: payment.paymentIntentId,
      amount: Math.round(refundAmount * 100), // convert to paise/cents
    });

    payment.status = "refunded";
    payment.refundedAt = new Date();
    await payment.save();

    return res.json({
      success: true,
      message: "Refund processed ✅",
      refundAmount,
      cancellationCharge:
        cancellation?.enabled && cancellation?.percentage > 0
          ? `${cancellation.percentage}% applied`
          : "No cancellation charge",
      data: refund
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
