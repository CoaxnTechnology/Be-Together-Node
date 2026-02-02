const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Service = require("../model/Service");
const User = require("../model/User");
const cron = require("node-cron");

//////////////////////////////////////////////////////////
// 🔐 Duplicate Event Protection
//////////////////////////////////////////////////////////
const processedEvents = new Set();

//////////////////////////////////////////////////////////
// 📦 PROMOTION PLANS
//////////////////////////////////////////////////////////
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
      line_items: [{ price: plan.priceId, quantity: 1 }],
      metadata: {
        userId,
        serviceId,
        promotionPlan,
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
  console.log("\n==============================");
  console.log("🔥 STRIPE WEBHOOK TRIGGERED");
  console.log("==============================");

  const sig = req.headers["stripe-signature"];
  console.log("Signature Header:", sig ? "Present" : "Missing");

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log("✅ Webhook Verified");
    console.log("Event ID:", event.id);
    console.log("Event Type:", event.type);
  } catch (err) {
    console.log("❌ Signature Verification Failed:", err.message);
    return res.status(400).send("Webhook Error");
  }

  // Prevent duplicate events
  if (processedEvents.has(event.id)) {
    console.log("⚠ Duplicate event ignored:", event.id);
    return res.json({ received: true });
  }

  processedEvents.add(event.id);

  const data = event.data.object;
  console.log("📦 Event Data Object:", JSON.stringify(data, null, 2));

  try {
    //////////////////////////////////////////////////////////////
    // CHECKOUT COMPLETED
    //////////////////////////////////////////////////////////////
    if (event.type === "checkout.session.completed") {
      console.log("➡ Handling checkout.session.completed");

      const subscriptionId = data.subscription;
      const metadata = data.metadata || {};

      console.log("Subscription ID:", subscriptionId);
      console.log("Metadata:", metadata);

      if (!subscriptionId) {
        console.log("❌ No subscriptionId found");
        return res.json({ received: true });
      }

      const serviceId = metadata.serviceId;
      if (!serviceId) {
        console.log("❌ No serviceId in metadata");
        return res.json({ received: true });
      }

      console.log("🔎 Fetching subscription from Stripe...");
      const subscription = await stripe.subscriptions.retrieve(
        subscriptionId
      );

      console.log(
        "📄 Subscription Object:",
        JSON.stringify(subscription, null, 2)
      );

      console.log(
        "current_period_start:",
        subscription.current_period_start
      );
      console.log(
        "current_period_end:",
        subscription.current_period_end
      );

      if (
        !subscription.current_period_start ||
        !subscription.current_period_end
      ) {
        console.log("⚠ Period dates not ready yet");
        return res.json({ received: true });
      }

      const startDate = new Date(
        subscription.current_period_start * 1000
      );
      const endDate = new Date(
        subscription.current_period_end * 1000
      );

      console.log("Converted Start Date:", startDate);
      console.log("Converted End Date:", endDate);

      if (
        isNaN(startDate.getTime()) ||
        isNaN(endDate.getTime())
      ) {
        console.log("❌ Invalid Date Detected");
        return res.json({ received: true });
      }

      console.log("🔎 Fetching service from DB:", serviceId);
      const service = await Service.findById(serviceId);

      if (!service) {
        console.log("❌ Service not found in DB");
        return res.json({ received: true });
      }

      console.log("✅ Service Found:", service._id);

      service.promotionSubscriptionId = subscription.id;
      service.promotionPriceId =
        subscription.items.data[0]?.price?.id;
      service.promotionStart = startDate;
      service.promotionEnd = endDate;
      service.isPromoted = true;
      service.promotionStatus = "active";
      service.promotionAutoRenew = true;

      console.log("💾 Saving service to DB...");
      await service.save();

      console.log("🎉 Promotion Activated Successfully");
    }

    //////////////////////////////////////////////////////////////
    // INVOICE PAID (RENEWAL)
    //////////////////////////////////////////////////////////////
    if (event.type === "invoice.paid") {
      console.log("➡ Handling invoice.paid");

      const subscriptionId = data.subscription;
      console.log("Subscription ID from invoice:", subscriptionId);

      if (!subscriptionId) {
        console.log("❌ Invoice has no subscription");
        return res.json({ received: true });
      }

      const subscription = await stripe.subscriptions.retrieve(
        subscriptionId
      );

      console.log(
        "Subscription for renewal:",
        JSON.stringify(subscription, null, 2)
      );

      if (
        !subscription.current_period_start ||
        !subscription.current_period_end
      ) {
        console.log("⚠ Renewal dates missing");
        return res.json({ received: true });
      }

      const startDate = new Date(
        subscription.current_period_start * 1000
      );
      const endDate = new Date(
        subscription.current_period_end * 1000
      );

      console.log("Renewal Start Date:", startDate);
      console.log("Renewal End Date:", endDate);

      if (
        isNaN(startDate.getTime()) ||
        isNaN(endDate.getTime())
      ) {
        console.log("❌ Invalid renewal date");
        return res.json({ received: true });
      }

      const service = await Service.findOne({
        promotionSubscriptionId: subscriptionId,
      });

      if (!service) {
        console.log("❌ No service found for renewal");
        return res.json({ received: true });
      }

      console.log("Updating renewal in DB...");
      service.promotionStart = startDate;
      service.promotionEnd = endDate;
      service.isPromoted = true;
      service.promotionStatus = "active";

      await service.save();

      console.log("🔄 Renewal Updated Successfully");
    }

    //////////////////////////////////////////////////////////////
    // PAYMENT FAILED
    //////////////////////////////////////////////////////////////
    if (event.type === "invoice.payment_failed") {
      console.log("➡ Handling invoice.payment_failed");

      const subscriptionId = data.subscription;

      const service = await Service.findOne({
        promotionSubscriptionId: subscriptionId,
      });

      if (service) {
        service.isPromoted = false;
        service.promotionStatus = "payment_failed";
        await service.save();
        console.log("❌ Marked as payment_failed");
      }
    }

    //////////////////////////////////////////////////////////////
    // SUBSCRIPTION DELETED
    //////////////////////////////////////////////////////////////
    if (event.type === "customer.subscription.deleted") {
      console.log("➡ Handling subscription deleted");

      const service = await Service.findOne({
        promotionSubscriptionId: data.id,
      });

      if (service) {
        service.isPromoted = false;
        service.promotionStatus = "cancelled";
        service.promotionAutoRenew = false;
        await service.save();
        console.log("🛑 Subscription Cancelled");
      }
    }

    console.log("✅ Webhook completed successfully");
    return res.json({ received: true });

  } catch (err) {
    console.log("❌ WEBHOOK PROCESSING ERROR:");
    console.log(err);
    return res.status(500).send("Webhook Failed");
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

  console.log("Expired promotions:", result.modifiedCount);
});
