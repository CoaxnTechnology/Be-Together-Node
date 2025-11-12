const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../model/User");

// Create a connected account for provider
exports.createConnectedAccount = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const account = await stripe.accounts.create({
      type: "express",
      country: "IT",
      email: user.email,
      capabilities: {
        transfers: { requested: true }, // ⬅️ keep transfers first
        card_payments: { requested: true },
      },
    });

    user.stripeAccountId = account.id;
    await user.save();

    // const accountLink = await stripe.accountLinks.create({
    //   account: account.id,
    //   refresh_url: `${process.env.FRONTEND_URL}/onboarding/refresh`,
    //   return_url: `${process.env.FRONTEND_URL}/onboarding/success`,
    //   type: "account_onboarding",
    // });

    res.status(200).json({ isSuccess: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Retrieve provider account info
exports.getConnectedAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user?.stripeAccountId)
      return res.status(404).json({ message: "Stripe account not found" });

    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    res.status(200).json({ isSuccess: true, data: account });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Generate Stripe dashboard login link
exports.createLoginLink = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user?.stripeAccountId)
      return res.status(404).json({ message: "Stripe account not found" });

    const loginLink = await stripe.accounts.createLoginLink(
      user.stripeAccountId
    );
    res.status(200).json({ isSuccess: true, url: loginLink.url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
// Create Stripe Customer for normal user
exports.createStripeCustomer = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: "User not found" });

    // Create stripe customer
    const customer = await stripe.customers.create({ email: user.email });

    user.stripeCustomerId = customer.id;
    await user.save();

    return res.status(200).json({
      isSuccess: true,
      message: "Stripe customer created",
      stripeCustomerId: customer.id,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.createOnboardingLink = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user || !user.stripeAccountId)
      return res.status(404).json({ message: "Stripe account not found" });

    const accountLink = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: "https://example.com/refresh",
      return_url: "https://example.com/success",
      type: "account_onboarding",
    });

    res.status(200).json({
      isSuccess: true,
      message: "Onboarding link created",
      url: accountLink.url,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
