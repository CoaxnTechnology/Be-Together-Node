// Stripe Connect payout accounts for providers (paid Services, request
// offers). One place for: "can this user be paid?" and onboarding links.
const crypto = require("crypto");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// After a successful onboarding Stripe sends the user here — kept as before
// so the app's existing webview handling ("…/success" = done) still works.
const ONBOARDING_RETURN_URL = "https://example.com/success";

// Account Links are single-use and expire within minutes. When one is opened
// twice or too late, Stripe sends the browser to refresh_url — that's our
// own endpoint, which mints a fresh link and redirects straight back to
// Stripe (instead of the old dead "example.com/refresh" page). The signature
// makes sure only links we issued can be refreshed.
function signAccount(accountId) {
  return crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || ""))
    .update(String(accountId))
    .digest("hex")
    .slice(0, 32);
}

function refreshUrl(accountId) {
  const base = String(process.env.BASE_URL || "").replace(/\/$/, "");
  return `${base}/api/stripe/connect/onboarding/refresh?account=${encodeURIComponent(accountId)}&sig=${signAccount(accountId)}`;
}

async function createOnboardingLink(accountId) {
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl(accountId),
    return_url: ONBOARDING_RETURN_URL,
    type: "account_onboarding",
  });
  return link.url;
}

// Can this user be paid out? Same rule as before: an Express account must
// exist and its KYC must be complete. If not, the account is created when
// missing and an onboarding link is returned for the app to open.
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
  return { ready: false, onboardingUrl: await createOnboardingLink(user.stripeAccountId) };
}

// GET /api/stripe/connect/onboarding/refresh?account=…&sig=…
// (Stripe's refresh_url) → a new onboarding link, redirected to directly.
async function onboardingRefresh(req, res) {
  const { account, sig } = req.query;
  const expected = account ? signAccount(account) : "";
  const valid =
    typeof sig === "string" &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) {
    return res.status(400).send("This setup link is not valid. Please start again from the BeTogether app.");
  }
  try {
    return res.redirect(302, await createOnboardingLink(account));
  } catch (err) {
    console.error("[stripeConnect] onboarding refresh failed", err.message);
    return res
      .status(500)
      .send("We couldn't reopen the Stripe setup. Please start again from the BeTogether app.");
  }
}

module.exports = { ensurePayoutAccount, createOnboardingLink, onboardingRefresh };
