const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const PromotionPlan = require("../model/PromotionPlan");

//////////////////////////////////////////////////////////
// CREATE PLAN (Basic – 7 Days)
//////////////////////////////////////////////////////////
exports.createPromotionPlan = async (req, res) => {
  try {
    const { name, days, price } = req.body;

    if (!name || !days || !price) {
      return res.status(400).json({
        message: "Name, Days and Price required",
      });
    }

    // Prevent duplicate duration
    const existing = await PromotionPlan.findOne({ days });
    if (existing) {
      return res.status(400).json({
        message: "Plan with same duration already exists",
      });
    }

    //////////////////////////////////////////////////
    // Create Stripe Price under ONE product
    //////////////////////////////////////////////////
    const stripePrice = await stripe.prices.create({
      unit_amount: price * 100,
      currency: "eur",
      recurring: {
        interval: "day",
        interval_count: days,
      },
      product: process.env.STRIPE_PROMOTION_PRODUCT_ID,
    });
    console.log("Product ID:", process.env.STRIPE_PROMOTION_PRODUCT_ID);
    //////////////////////////////////////////////////
    // Save in DB
    //////////////////////////////////////////////////
    const plan = await PromotionPlan.create({
      name,
      days,
      price,
      stripePriceId: stripePrice.id,
    });

    res.json({ isSuccess: true, plan });
  } catch (err) {
    console.error(err);
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
