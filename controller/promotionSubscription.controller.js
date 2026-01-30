const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../model/User");
const Service = require("../model/Service");

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
// 1️⃣ CREATE PROMOTION SUBSCRIPTION CHECKOUT (SERVICE REQUIRED)
// ==================================================
exports.createPromotionSubscriptionCheckout = async (req, res) => {
  try {
    const { userId, serviceId, promotionPlan } = req.body;

    if (!userId || !serviceId || !promotionPlan) {
      return res.status(400).json({
        isSuccess: false,
        message: "userId, serviceId & promotionPlan required",
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

    const service = await Service.findById(serviceId);
    if (!service || service.owner.toString() !== userId) {
      return res.status(403).json({
        isSuccess: false,
        message: "Invalid service",
      });
    }

    if (service.isPromoted) {
      return res.status(400).json({
        isSuccess: false,
        message: "Service already promoted",
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

    // 🔹 Create Checkout Session
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
        serviceId,
        promotionPlan,
      },

      success_url:
        "https://yourapp.com/promotion-success?session_id={CHECKOUT_SESSION_ID}",

      cancel_url: "https://yourapp.com/promotion-cancel?serviceId=" + serviceId,
    });

    return res.json({
      isSuccess: true,
      redirectUrl: session.url,
    });
  } catch (err) {
    console.error("createPromotionCheckout error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// ==================================================
// 2️⃣ CONFIRM PROMOTION AFTER PAYMENT SUCCESS
// ==================================================
exports.confirmPromotionAfterPayment = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        isSuccess: false,
        message: "sessionId required",
      });
    }

    // 1️⃣ Retrieve checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session.subscription) {
      return res.status(400).json({
        isSuccess: false,
        message: "Subscription not found in session",
      });
    }

    // 2️⃣ Retrieve full subscription safely
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // 3️⃣ Validate subscription status
    if (!["active", "trialing"].includes(subscription.status)) {
      return res.status(400).json({
        isSuccess: false,
        message: "Subscription not active",
      });
    }

    const { userId, serviceId, promotionPlan } = session.metadata;

    if (!userId || !serviceId || !promotionPlan) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid metadata",
      });
    }

    const plan = SUBSCRIPTION_PLANS[promotionPlan];
    if (!plan) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid promotion plan",
      });
    }

    const service = await Service.findById(serviceId);

    if (!service || service.owner.toString() !== userId) {
      return res.status(403).json({
        isSuccess: false,
        message: "Invalid service",
      });
    }

    if (service.isPromoted) {
      return res.status(400).json({
        isSuccess: false,
        message: "Service already promoted",
      });
    }

    // 4️⃣ Plan fraud protection
    const stripePriceId = subscription.items.data[0].price.id;

    if (stripePriceId !== plan.priceId) {
      return res.status(400).json({
        isSuccess: false,
        message: "Plan mismatch",
      });
    }

    // 5️⃣ Safe Date Validation
    const startTs = subscription.current_period_start;
    const endTs = subscription.current_period_end;

    if (!startTs || !endTs) {
      return res.status(400).json({
        isSuccess: false,
        message: "Stripe subscription period missing",
      });
    }

    const startDate = new Date(startTs * 1000);
    const endDate = new Date(endTs * 1000);

    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid subscription dates",
      });
    }

    // 6️⃣ APPLY PROMOTION
    service.isPromoted = true;
    service.promotionType = "subscription";
    service.promotionSubscriptionId = subscription.id;
    service.promotionPriceId = stripePriceId;
    service.promotionPlanDays = plan.days;
    service.promotionAutoRenew = true;
    service.promotionStatus = "active";
    service.promotionAmount =
      subscription.items.data[0].price.unit_amount / 100;
    service.promotionStart = startDate;
    service.promotionEnd = endDate;

    await service.save();

    return res.json({
      isSuccess: true,
      message: "Service promoted successfully 🎉",
    });
  } catch (err) {
    console.error("confirmPromotion error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};



// ==================================================
// 3️⃣ CANCEL PROMOTION (AT PERIOD END)
// ==================================================
exports.getPromotionSubscriptionFromSession = async (req, res) => {
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
      message: "Subscription will cancel at period end",
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
