// Can this user be paid out through Stripe Connect? Same rule as creating a
// paid Service (serviceController): an Express account must exist and its
// KYC must be complete. If not, the account is created when missing and an
// onboarding link is returned for the app to open.
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Same URLs the paid-Service onboarding already uses, so the app's existing
// webview handling keeps working.
const ONBOARDING_REFRESH_URL = "https://example.com/refresh";
const ONBOARDING_RETURN_URL = "https://example.com/success";

async function ensurePayoutAccount(user) {
  if (!user.stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "IT",
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    user.stripeAccountId = account.id;
    await user.save();
  }

  const account = await stripe.accounts.retrieve(user.stripeAccountId);
  if (account.charges_enabled && account.details_submitted) {
    return { ready: true };
  }

  const link = await stripe.accountLinks.create({
    account: user.stripeAccountId,
    refresh_url: ONBOARDING_REFRESH_URL,
    return_url: ONBOARDING_RETURN_URL,
    type: "account_onboarding",
  });
  return { ready: false, onboardingUrl: link.url };
}

module.exports = { ensurePayoutAccount };
