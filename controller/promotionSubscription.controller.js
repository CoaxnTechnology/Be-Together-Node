const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../model/User");

// ===============================
// PROMOTION SUBSCRIPTION PLANS
// ===============================
const SUBSCRIPTION_PLANS = {
  basic: {
    priceId: "price_1SuBhHRic3VtmD7tZJ7O7806",
    days: 7,
  },
  standard: {
    priceId: "price_1SuBk3Ric3VtmD7tJ23qLcMP",
    days: 15,
  },
  premium: {
    priceId: "price_1SuBkmRic3VtmD7tnXtXQbnI",
    days: 30,
  },
};

// ==================================================
// 1️⃣ CREATE PROMOTION SUBSCRIPTION (CHECKOUT URL)
// ==================================================
exports.createPromotionSubscriptionCheckout = async (req, res) => {
  try {
    const { userId, promotionPlan } = req.body;

    if (!userId || !promotionPlan) {
      return res.status(400).json({
        isSuccess: false,
        message: "userId & promotionPlan required",
      });
    }

    const plan = SUBSCRIPTION_PLANS[promotionPlan];
    if (!plan) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid promotion plan",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // 🔹 Create Stripe customer if not exists
    let customerStripeId = user.stripeCustomerId;
    if (!customerStripeId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      user.stripeCustomerId = customer.id;
      await user.save();
      customerStripeId = customer.id;
    }

    // 🔹 Create Checkout Session (SUBSCRIPTION)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerStripeId,
      payment_method_types: ["card"],

      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],

      metadata: {
        userId,
        promotionPlan,
      },

      success_url:
        "https://yourapp.com/promotion-success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://yourapp.com/promotion-cancel",
    });

    return res.json({
      isSuccess: true,
      redirectUrl: session.url, // 🔥 Mobile WebView uses this
    });
  } catch (err) {
    console.error("createPromotionSubscriptionCheckout error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// ==================================================
// 2️⃣ GET SUBSCRIPTION ID FROM CHECKOUT SESSION
// ==================================================
exports.getPromotionSubscriptionFromSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    if (!session.subscription) {
      return res.status(400).json({
        isSuccess: false,
        message: "Subscription not found for this session",
      });
    }

    return res.json({
      isSuccess: true,
      subscriptionId: session.subscription.id,
      promotionPlan: session.metadata.promotionPlan,
      status: session.subscription.status,
      currentPeriodStart: session.subscription.current_period_start,
      currentPeriodEnd: session.subscription.current_period_end,
    });
  } catch (err) {
    console.error("getPromotionSubscriptionFromSession error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// ==================================================
// 3️⃣ CANCEL PROMOTION SUBSCRIPTION (OPTIONAL)
// ==================================================
exports.cancelPromotionSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({
        isSuccess: false,
        message: "subscriptionId required",
      });
    }

    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    return res.json({
      isSuccess: true,
      message: "Subscription will be cancelled at period end",
      status: subscription.status,
      cancelAt: subscription.cancel_at,
    });
  } catch (err) {
    console.error("cancelPromotionSubscription error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
