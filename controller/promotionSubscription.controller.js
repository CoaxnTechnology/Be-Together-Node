const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../models/User");
// Promotion subscription plans (Stripe PRICE IDs)
const SUBSCRIPTION_PLANS = {
  basic: {
    priceId: "price_basic_7days",   // Stripe dashboard
    days: 7,
  },
  standard: {
    priceId: "price_standard_15days",
    days: 15,
  },
  premium: {
    priceId: "price_premium_30days",
    days: 30,
  },
};



exports.createPromotionSubscription = async (req, res) => {
  try {
    const { userId, promotionPlan, paymentMethodId } = req.body;

    if (!userId || !promotionPlan || !paymentMethodId) {
      return res.status(400).json({
        isSuccess: false,
        message: "userId, promotionPlan, paymentMethodId required",
      });
    }

    const plan = SUBSCRIPTION_PLANS[promotionPlan];
    if (!plan) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid promotion plan",
      });
    }

    // 1️⃣ Get / create Stripe customer
    let customerId;
    const user = await User.findById(userId);

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    customerId = user.stripeCustomerId;

    // 2️⃣ Attach payment method (MANDATE CREATED HERE)
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // 3️⃣ Create subscription (AUTO-RENEW)
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: plan.priceId }],
      payment_settings: {
        payment_method_types: ["card", "sepa_debit"],
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        userId,
        promotionPlan,
      },
    });

    return res.json({
      isSuccess: true,
      message: "Promotion subscription created (auto-renew enabled)",
      data: {
        subscriptionId: subscription.id,
        status: subscription.status,
        promotionPlan,
      },
    });
  } catch (err) {
    console.error("createPromotionSubscription error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};
