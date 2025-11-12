const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Payment = require("../model/Payment");
const Invoice = require("../model/Invoice");
const User = require("../model/User");

exports.handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      const pi = event.data.object;
      await Payment.updateOne(
        { paymentIntentId: pi.id },
        { status: "completed", completedAt: new Date() }
      );
      await Invoice.updateOne(
        { paymentIntentId: pi.id },
        { status: "paid" }
      );
      break;
    case "charge.refunded":
      const charge = event.data.object;
      await Payment.updateOne(
        { paymentIntentId: charge.payment_intent },
        { status: "refunded", refundedAt: new Date() }
      );
      break;
  }

  res.status(200).json({ received: true });
};
