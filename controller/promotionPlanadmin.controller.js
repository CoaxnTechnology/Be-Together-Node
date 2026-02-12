const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const PromotionPlan = require("../model/PromotionPlan");

//////////////////////////////////////////////////////////
// CREATE PLAN (Basic – 7 Days)
//////////////////////////////////////////////////////////
exports.createPromotionPlan = async (req, res) => {
  console.log("========== CREATE PROMOTION PLAN START ==========");
  console.log("Request Body:", req.body);

  try {
    const { name, days, description, price } = req.body;

    console.log("Parsed Values:");
    console.log("Name:", name);
    console.log("Days:", days);
    console.log("Description:", description);
    console.log("Price:", price);

    //////////////////////////////////////////////////
    // Validation
    //////////////////////////////////////////////////
    if (!name || !days || !price) {
      console.log("Validation Failed: Missing required fields");
      return res.status(400).json({
        message: "Name, Days and Price required",
      });
    }

    console.log("Validation Passed");

    //////////////////////////////////////////////////
    // Check Duplicate Duration
    //////////////////////////////////////////////////
    console.log("Checking existing plan with same days...");
    const existing = await PromotionPlan.findOne({ days });

    if (existing) {
      console.log("Duplicate plan found:", existing);
      return res.status(400).json({
        message: "Plan with same duration already exists",
      });
    }

    console.log("No duplicate plan found");

    //////////////////////////////////////////////////
    // Stripe Price Creation
    //////////////////////////////////////////////////
    console.log("Creating Stripe price...");
    console.log("Stripe Product ID:", process.env.STRIPE_PROMOTION_PRODUCT_ID);

    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "eur",
      recurring: {
        interval: "day",
        interval_count: days,
      },
      product: process.env.STRIPE_PROMOTION_PRODUCT_ID,
    });

    console.log("Stripe price created successfully");
    console.log("Stripe Price ID:", stripePrice.id);
    console.log("Full Stripe Response:", stripePrice);

    //////////////////////////////////////////////////
    // Save in Database
    //////////////////////////////////////////////////
    console.log("Saving plan in database...");

    const plan = await PromotionPlan.create({
      name,
      days,
      price,
      description,
      stripePriceId: stripePrice.id,
    });

    console.log("Plan saved successfully:", plan);

    console.log("========== CREATE PROMOTION PLAN SUCCESS ==========");

    res.json({ isSuccess: true, plan });
  } catch (err) {
    console.log("========== CREATE PROMOTION PLAN ERROR ==========");
    console.error("Error Details:", err);
    console.log("========== CREATE PROMOTION PLAN FAILED ==========");

    res.status(500).json({ message: "Error creating plan" });
  }
};

exports.getPromotionPlans = async (req, res) => {
  try {
    const plans = await PromotionPlan.find({ isActive: true }).sort({
      days: 1,
    });

    res.json({ plans });
  } catch (err) {
    res.status(500).json({ message: "Error fetching plans" });
  }
};
exports.updatePromotionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, days, price } = req.body;

    const plan = await PromotionPlan.findById(id);
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    let stripePriceId = plan.stripePriceId;

    if (price !== plan.price || days !== plan.days) {
      const newPrice = await stripe.prices.create({
        unit_amount: price * 100,
        currency: "eur",
        recurring: {
          interval: "day",
          interval_count: days,
        },
        product: process.env.STRIPE_PROMOTION_PRODUCT_ID,
      });

      stripePriceId = newPrice.id;
    }

    plan.name = name;
    plan.days = days;
    plan.price = price;
    plan.stripePriceId = stripePriceId;

    await plan.save();

    res.json({ isSuccess: true, plan });
  } catch (err) {
    res.status(500).json({ message: "Error updating plan" });
  }
};
exports.deletePromotionPlan = async (req, res) => {
  try {
    const { id } = req.params;

    await PromotionPlan.findByIdAndUpdate(id, {
      isActive: false,
    });

    res.json({ isSuccess: true });
  } catch (err) {
    res.status(500).json({ message: "Error deleting plan" });
  }
};
