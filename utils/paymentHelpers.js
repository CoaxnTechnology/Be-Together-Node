// Shared payment building blocks — used by the Service Request payment flow
// (controller/requestPaymentController.js) and by the shared booking steps
// (start / verify-otp) in paymentController.js. Pure calculations + small
// Stripe/DB helpers only; no request/response handling lives here.
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const CommissionSetting = require("../model/CommissionSetting");
const AdminWalletConfig = require("../model/AdminWalletConfig");
const Wallet = require("../model/Wallet");
const WalletHistory = require("../model/WalletHistory");
const { notifyWalletTransaction } = require("../controller/notificationController");

const round2 = (n) => Number(Number(n || 0).toFixed(2));

// Platform commission % for both sides, read from the admin setting.
async function getCommissionPercents() {
  const setting = await CommissionSetting.findOne();
  return {
    providerCommissionPercent: setting?.providerCommissionPercentage || 0,
    customerCommissionPercent: setting?.customerCommissionPercentage || 0,
  };
}

// Same split bookService uses: the provider pays providerCommission out of
// the amount, the customer pays customerCommission on top of it.
function splitCommission(amount, providerCommissionPercent, customerCommissionPercent) {
  const providerCommissionAmount = round2((amount * providerCommissionPercent) / 100);
  const customerCommissionAmount = round2((amount * customerCommissionPercent) / 100);
  return {
    providerCommissionAmount,
    customerCommissionAmount,
    providerAmount: round2(amount - providerCommissionAmount),
    customerPayable: round2(amount + customerCommissionAmount),
  };
}

// Wallet coin redemption — same rules as bookService (admin max %, coins
// already reserved by other unfinished bookings can't be used twice).
async function calculateWalletRedemption({
  userId,
  amount,
  providerAmount,
  customerCommissionAmount,
}) {
  const result = {
    wallet: null,
    walletCoinsUsed: 0,
    walletAmountUsed: 0,
    customerPayable: round2(amount + customerCommissionAmount),
    platformContribution: 0,
  };

  const [config, wallet] = await Promise.all([
    AdminWalletConfig.findOne(),
    Wallet.findOne({ user: userId }),
  ]);
  result.wallet = wallet;
  if (!config || !wallet || wallet.points <= 0) return result;

  const redeemPercent = Number(config.maxWalletUsagePercent) || 0;
  const coinValue = Number(config.coinToCurrencyValue) || 1;
  const availableCoins = Math.max(0, wallet.points - (wallet.reservedPoints || 0));

  const walletCoinsUsed = Math.min(
    availableCoins,
    Math.floor((amount * redeemPercent) / 100),
  );
  const walletAmountUsed = Math.min(walletCoinsUsed * coinValue, amount);
  const customerPayable = Math.max(
    0,
    round2(amount - walletAmountUsed + customerCommissionAmount),
  );

  return {
    wallet,
    walletCoinsUsed,
    walletAmountUsed,
    customerPayable,
    platformContribution: Math.max(0, round2(providerAmount - customerPayable)),
  };
}

// Frees coins a booking had reserved but never spent (cancel / refund /
// abandoned checkout). Coins are only actually spent on completion.
async function releaseReservedWalletCoins(userId, coins, { note, notifyUser } = {}) {
  if (!coins || coins <= 0) return;
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) return;
  wallet.reservedPoints = Math.max(0, (wallet.reservedPoints || 0) - coins);
  await wallet.save();

  if (note) {
    await WalletHistory.create({
      user: userId,
      points: coins,
      transactionType: "credit",
      type: "wallet_refund",
      service: null,
      note,
    });
  }
  if (notifyUser) {
    notifyWalletTransaction(notifyUser, "wallet_refund", coins).catch((err) =>
      console.error("❌ notifyWalletTransaction error:", err.message),
    );
  }
}

// Turns reserved coins into spent coins once the job is completed.
async function spendReservedWalletCoins(customer, coins) {
  if (!coins || coins <= 0) return;
  const wallet = await Wallet.findOne({ user: customer._id });
  if (!wallet) return;
  wallet.reservedPoints = Math.max(0, (wallet.reservedPoints || 0) - coins);
  wallet.points = Math.max(0, wallet.points - coins);
  wallet.totalSpent += coins;
  await wallet.save();

  await WalletHistory.create({
    user: customer._id,
    points: -coins,
    transactionType: "debit",
    type: "wallet_spent",
    service: null,
    note: "Wallet used during booking",
  });
  notifyWalletTransaction(customer, "wallet_spent", coins).catch((err) =>
    console.error("❌ notifyWalletTransaction error:", err.message),
  );
}

async function getOrCreateStripeCustomer(customer) {
  if (customer.stripeCustomerId) return customer.stripeCustomerId;
  const created = await stripe.customers.create({
    email: customer.email,
    name: customer.name,
  });
  customer.stripeCustomerId = created.id;
  await customer.save();
  return created.id;
}

// A Service Request booking has no `service` — give start/verify/complete/
// cancel the same { _id, title, isFree, city } shape from the request
// instead, so emails, notifications and transfer metadata work unchanged.
function bookingSubject(booking) {
  if (booking.service) return booking.service;
  const r = booking.serviceRequest;
  if (!r) return null;
  return {
    _id: r._id,
    title: r.title,
    isFree: Boolean(r.isFree),
    city: r.location_name || null,
  };
}

module.exports = {
  round2,
  getCommissionPercents,
  splitCommission,
  calculateWalletRedemption,
  releaseReservedWalletCoins,
  spendReservedWalletCoins,
  getOrCreateStripeCustomer,
  bookingSubject,
};
