const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Service = require("../model/Service");
const User = require("../model/User");
const cron = require("node-cron");
const PromotionPlan = require("../model/PromotionPlan");

//////////////////////////////////////////////////////////
// 🔐 Duplicate Event Protection
//////////////////////////////////////////////////////////
const processedEvents = new Set();

//////////////////////////////////////////////////////////
// 📦 PROMOTION PLANS
//////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////
// 1️⃣ CREATE CHECKOUT SESSION
//////////////////////////////////////////////////////////
exports.createPromotionSubscriptionCheckout = async (req, res) => {
  try {
    const { userId, serviceId, planId } = req.body;

    if (!userId || !serviceId || !planId) {
      return res.status(400).json({
        isSuccess: false,
        message: "userId, serviceId & planId required",
      });
    }

    const plan = await PromotionPlan.findById(planId);
    if (!plan || !plan.isActive) {
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

    // Create Stripe customer if not exists
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
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      metadata: {
        userId,
        serviceId,
        planId: plan._id.toString(),
        planName: plan.name,
        planDays: plan.days,
      },
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
// 2️⃣ STRIPE WEBHOOK HANDLER
exports.stripeWebhook = async (req, res) => {
  // console.log("\n==============================");
  console.log("🔥 STRIPE WEBHOOK HIT");
  //console.log("==============================");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    console.log("✅ Event Verified:", event.type);
  } catch (err) {
    console.log("❌ Signature failed:", err.message);
    return res.status(400).send("Webhook Error");
  }

  const data = event.data.object;

  try {
    //////////////////////////////////////////////////////////////
    // 1️⃣ CHECKOUT COMPLETED
    //////////////////////////////////////////////////////////////
    if (event.type === "checkout.session.completed") {
      console.log("➡ checkout.session.completed triggered");

      const subscriptionId = data.subscription;
      const serviceId = data.metadata?.serviceId;

      console.log("Subscription ID:", subscriptionId);
      console.log("Service ID:", serviceId);

      if (!subscriptionId || !serviceId) {
        console.log("⚠ Missing subscriptionId or serviceId");
        return res.json({ received: true });
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const item = subscription.items?.data?.[0];

      if (!item?.current_period_start || !item?.current_period_end) {
        console.log("⚠ Period not ready");
        return res.json({ received: true });
      }

      const startDate = new Date(item.current_period_start * 1000);
      const endDate = new Date(item.current_period_end * 1000);

      const service = await Service.findById(serviceId);
      if (!service) {
        console.log("❌ Service not found");
        return res.json({ received: true });
      }

      service.promotionSubscriptionId = subscription.id;
      service.promotionPriceId = item.price.id;
      service.promotionStart = startDate;
      service.promotionEnd = endDate;
      service.isPromoted = true;
      service.promotionStatus = "active";
      service.promotionAutoRenew = true;

      await service.save();

      console.log("✅ Promotion Activated (First Time)");
    }

    //////////////////////////////////////////////////////////////
    // 2️⃣ INVOICE PAID (RENEWAL)
    //////////////////////////////////////////////////////////////
    if (event.type === "invoice.paid") {
      console.log("➡ invoice.paid triggered");

      const subscriptionId = data.parent?.subscription_details?.subscription;

      console.log("Subscription ID from invoice:", subscriptionId);

      if (!subscriptionId) {
        console.log("⚠ No subscription in invoice");
        return res.json({ received: true });
      }

      const line = data.lines?.data?.[0];

      const startDate = new Date(line.period.start * 1000);
      const endDate = new Date(line.period.end * 1000);

      const service = await Service.findOne({
        promotionSubscriptionId: subscriptionId,
      });

      if (!service) {
        console.log("❌ Service not found for renewal");
        return res.json({ received: true });
      }

      service.promotionStart = startDate;
      service.promotionEnd = endDate;
      service.isPromoted = true;
      service.promotionStatus = "active";

      await service.save();

      console.log("🔄 Subscription Renewed Successfully");
    }

    //////////////////////////////////////////////////////////////
    // 3️⃣ PAYMENT FAILED (CARD REMOVED / BANK DECLINED)
    //////////////////////////////////////////////////////////////
    if (event.type === "invoice.payment_failed") {
      console.log("➡ invoice.payment_failed triggered");

      const subscriptionId = data.parent?.subscription_details?.subscription;

      console.log("Failed Subscription:", subscriptionId);

      const service = await Service.findOne({
        promotionSubscriptionId: subscriptionId,
      });

      if (service) {
        service.isPromoted = false;
        service.promotionStatus = "payment_failed";
        await service.save();

        console.log("❌ Marked as payment_failed in DB");
      }
    }

    //////////////////////////////////////////////////////////////
    // 4️⃣ SUBSCRIPTION UPDATED (Cancel at period end)
    //////////////////////////////////////////////////////////////
    if (event.type === "customer.subscription.updated") {
      console.log("➡ customer.subscription.updated triggered");

      console.log("Cancel at period end:", data.cancel_at_period_end);
      console.log("Subscription status:", data.status);

      const service = await Service.findOne({
        promotionSubscriptionId: data.id,
      });

      if (!service) {
        console.log("⚠ Service not found for update");
        return res.json({ received: true });
      }

      if (data.cancel_at_period_end) {
        service.promotionAutoRenew = false;
        service.promotionStatus = "cancel_scheduled";
        await service.save();

        console.log("⚠ Auto renew disabled (Cancel at period end)");
      }
    }

    //////////////////////////////////////////////////////////////
    // 5️⃣ SUBSCRIPTION DELETED (Immediate cancel)
    //////////////////////////////////////////////////////////////
    if (event.type === "customer.subscription.deleted") {
      console.log("➡ customer.subscription.deleted triggered");

      console.log("Subscription Cancelled Immediately:", data.id);

      const service = await Service.findOne({
        promotionSubscriptionId: data.id,
      });

      if (service) {
        service.isPromoted = false;
        service.promotionStatus = "cancelled";
        service.promotionAutoRenew = false;
        service.promotionCancelledAt = new Date();

        await service.save();

        console.log("🛑 Subscription Fully Cancelled & DB Updated");
      }
    }

    console.log("✅ Webhook Processing Done");
    return res.json({ received: true });
  } catch (err) {
    console.log("❌ Webhook error:", err);
    return res.status(500).send("Webhook Failed");
  }
};

//////////////////////////////////////////////////////////
// 3️⃣ MANUAL CANCEL API
//////////////////////////////////////////////////////////
exports.cancelPromotionSubscription = async (req, res) => {
  try {
    console.log("📩 Cancel subscription API called");
    console.log("Request body:", req.body);

    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      console.log("❌ subscriptionId missing");
      return res.status(400).json({
        isSuccess: false,
        message: "subscriptionId is required",
      });
    }

    console.log("🔄 Cancelling subscription:", subscriptionId);

    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    console.log("✅ Subscription updated successfully");
    console.log("Stripe response status:", subscription.status);

    res.json({
      isSuccess: true,
      message: "Will cancel at period end",
      status: subscription.status,
    });
  } catch (err) {
    console.log("❌ Error while cancelling subscription");
    console.log("Error message:", err.message);
    console.log("Full error:", err);

    res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

//////////////////////////////////////////////////////////
// 4️⃣ DAILY CRON JOB (AUTO EXPIRE CLEANUP)
//////////////////////////////////////////////////////////
cron.schedule("0 0 * * *", async () => {
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
    },
  );

  console.log("Expired promotions:", result.modifiedCount);
});
