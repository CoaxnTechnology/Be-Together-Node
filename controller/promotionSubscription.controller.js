const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Service = require("../model/Service");
const User = require("../model/User");
const cron = require("node-cron");

// =======================================
// 🔐 Duplicate Event Protection
// =======================================
const processedEvents = new Set();

// =======================================
// 📦 PROMOTION PLANS
// =======================================
const SUBSCRIPTION_PLANS = {
  basic: { priceId: "price_1SuBhHRic3VtmD7tZJ7O7806", days: 7 },
  standard: { priceId: "price_1SuBk3Ric3VtmD7tJ23qLcMP", days: 15 },
  premium: { priceId: "price_1SuBkmRic3VtmD7tnXtXQbnI", days: 30 },
};

//////////////////////////////////////////////////////////
// 1️⃣ CREATE CHECKOUT SESSION
//////////////////////////////////////////////////////////
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
    const service = await Service.findById(serviceId);

    if (!user || !service || service.owner.toString() !== userId) {
      return res.status(403).json({
        isSuccess: false,
        message: "Invalid user/service",
      });
    }

    if (service.isPromoted) {
      return res.status(400).json({
        isSuccess: false,
        message: "Service already promoted",
      });
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });

      user.stripeCustomerId = customer.id;
      await user.save();
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: plan.priceId, quantity: 1 }],
      metadata: { userId, serviceId, promotionPlan },
      success_url:
        "https://yourapp.com/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://yourapp.com/cancel",
    });

    res.json({ isSuccess: true, redirectUrl: session.url });
  } catch (err) {
    console.error("Checkout Error:", err);
    res.status(500).json({ isSuccess: false, message: err.message });
  }
};

//////////////////////////////////////////////////////////
// 2️⃣ STRIPE WEBHOOK (PRODUCTION SAFE)
//////////////////////////////////////////////////////////
exports.stripeWebhook = async (req, res) => {
  console.log("🔥 STRIPE WEBHOOK HIT");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("✅ Webhook Verified:", event.type);
  } catch (err) {
    console.error("❌ Signature Verification Failed:", err.message);
    return res.status(400).send("Webhook Error");
  }

  const data = event.data.object;

  try {
    ////////////////////////////////////////////////////////////
    // 1️⃣ FIRST PAYMENT SUCCESS
    ////////////////////////////////////////////////////////////
    if (event.type === "checkout.session.completed") {
      const { userId, serviceId } = data.metadata;

      const service = await Service.findById(serviceId);

      if (!service) {
        console.log("⚠ Service not found");
        return res.json({ received: true });
      }

      if (service.isPromoted) {
        console.log("⚠ Service already promoted");
        return res.json({ received: true });
      }

      const subscription = await stripe.subscriptions.retrieve(
        data.subscription
      );

      service.isPromoted = true;
      service.promotionType = "subscription";
      service.promotionSubscriptionId = subscription.id;
      service.promotionPriceId =
        subscription.items.data[0].price.id;
      service.promotionStart = new Date(
        subscription.current_period_start * 1000
      );
      service.promotionEnd = new Date(
        subscription.current_period_end * 1000
      );
      service.promotionStatus = "active";
      service.promotionAutoRenew = true;

      await service.save();

      console.log("✅ Service promoted successfully");
    }

    ////////////////////////////////////////////////////////////
    // 2️⃣ AUTO RENEW SUCCESS
    ////////////////////////////////////////////////////////////
    if (event.type === "invoice.paid") {
      const subscription = await stripe.subscriptions.retrieve(
        data.subscription
      );

      const service = await Service.findOne({
        promotionSubscriptionId: subscription.id,
      });

      if (service) {
        service.promotionStart = new Date(
          subscription.current_period_start * 1000
        );
        service.promotionEnd = new Date(
          subscription.current_period_end * 1000
        );
        service.isPromoted = true;
        service.promotionStatus = "active";

        await service.save();

        console.log("🔄 Subscription renewed");
      }
    }

    ////////////////////////////////////////////////////////////
    // 3️⃣ CANCEL AT PERIOD END
    ////////////////////////////////////////////////////////////
    if (event.type === "customer.subscription.updated") {
      if (data.cancel_at_period_end) {
        const service = await Service.findOne({
          promotionSubscriptionId: data.id,
        });

        if (service) {
          service.promotionAutoRenew = false;
          await service.save();

          console.log("⚠ Auto renew disabled");
        }
      }
    }

    ////////////////////////////////////////////////////////////
    // 4️⃣ FULL CANCEL OR EXPIRED
    ////////////////////////////////////////////////////////////
    if (event.type === "customer.subscription.deleted") {
      const service = await Service.findOne({
        promotionSubscriptionId: data.id,
      });

      if (service) {
        service.isPromoted = false;
        service.promotionStatus = "cancelled";
        service.promotionAutoRenew = false;

        await service.save();

        console.log("❌ Subscription fully cancelled");
      }
    }

    res.json({ received: true });

  } catch (err) {
    console.error("❌ Webhook Processing Error:", err);
    res.status(500).send("Webhook Failed");
  }
};


//////////////////////////////////////////////////////////
// 3️⃣ MANUAL CANCEL API
//////////////////////////////////////////////////////////
exports.cancelPromotionSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;

    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    res.json({
      isSuccess: true,
      message: "Will cancel at period end",
      status: subscription.status,
    });
  } catch (err) {
    res.status(500).json({ isSuccess: false, message: err.message });
  }
};

//////////////////////////////////////////////////////////
// 4️⃣ DAILY CRON JOB (AUTO EXPIRE CLEANUP)
//////////////////////////////////////////////////////////
cron.schedule("0 0 * * *", async () => {
  console.log("⏳ Running daily promotion expiry check...");

  const now = new Date();

  const result = await Service.updateMany(
    {
      isPromoted: true,
      promotionEnd: { $lt: now },
      promotionAutoRenew: false,
    },
    {
      $set: {
        isPromoted: false,
        promotionStatus: "expired",
      },
    }
  );

  console.log("Expired promotions updated:", result.modifiedCount);
});
