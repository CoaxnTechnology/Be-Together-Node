// =====================================================================
// SERVICE REQUEST PAYMENTS (paid_fixed + paid_offer bookings)
//
// Kept separate from paymentController.js (normal Service bookings) because
// the money rules differ:
//   • Customer pays at accept/book time — charged immediately, held on the
//     platform's Stripe balance.
//   • A Quotation Change is paid by the customer as its own Checkout for
//     ONLY the difference, and is also held on the platform.
//   • On completion the provider gets ONE transfer for the full total
//     (original + every paid difference), commission already split.
//   • Cancellation follows the policy the provider chose on the offer
//     (late_fee / free) with the late fee % from CommissionSetting, refunded
//     across every charge.
// Every Stripe object of one booking carries metadata.paymentGroup = the
// root Payment id, so all charges/refunds/transfers can be traced together.
//
// Shared steps stay in paymentController.js: start / verify-otp / My
// Bookings. /complete and /refund there forward request bookings here, so
// the app's routes don't change.
// =====================================================================
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cron = require("node-cron");
const Payment = require("../model/Payment");
const Booking = require("../model/Booking");
const User = require("../model/User");
const ServiceRequest = require("../model/ServiceRequest");
const ServiceRequestOffer = require("../model/ServiceRequestOffer");
const mongoose = require("mongoose");
const CommissionSetting = require("../model/CommissionSetting");
const updateProviderPerformance = require("../utils/providerPerformance");
const { parseDateTime } = require("../utils/dateTimeFormat");
const {
  sendServiceCompletedEmail,
  sendServiceCancelledEmail,
} = require("../utils/email");
const {
  sendBookingNotification,
  sendServiceCompletedNotification,
  sendServiceCancelledNotification,
  notifyQuotationChangeSubmitted,
  notifyQuotationChangeResponded,
  notifyOfferDeclined,
} = require("./notificationController");
const {
  round2,
  getCommissionPercents,
  splitCommission,
  calculateWalletRedemption,
  releaseReservedWalletCoins,
  spendReservedWalletCoins,
  getOrCreateStripeCustomer,
  bookingSubject,
} = require("../utils/paymentHelpers");

const log = (step, data = {}) => console.log(`[requestPayment] ${step}`, data);
const logError = (step, err) =>
  console.error(`[requestPayment] ${step}`, {
    message: err?.message,
    stack: err?.stack,
  });

// Same return URLs as normal Service checkout — the app already handles them.
const SUCCESS_URL =
  "https://yourflutterapp.com/payment-success?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://yourflutterapp.com/payment-cancel";

// "late_fee" policy: free cancellation until this long before the start.
const LATE_CANCEL_WINDOW_MS = 60 * 60 * 1000;

const OPEN_QUOTATION_STATUSES = ["pending", "awaiting_payment"];

function serviceStartFromRequest(request) {
  if (!request?.schedule?.date || !request?.schedule?.startTime) return null;
  return parseDateTime(`${request.schedule.date} ${request.schedule.startTime}`);
}

// Gives back the seat an unfinished payment was holding, and puts its offer
// back to "pending" so the customer can accept it (or another one) again.
async function releaseSeatAndOffer(serviceRequestId, offerId) {
  if (!serviceRequestId) return;
  await ServiceRequest.updateOne(
    { _id: serviceRequestId, seatsBooked: { $gt: 0 } },
    { $inc: { seatsBooked: -1 } },
  );
  await ServiceRequest.updateOne(
    { _id: serviceRequestId, status: "fulfilled" },
    { status: "open" },
  );
  if (offerId) {
    await ServiceRequestOffer.updateOne(
      { _id: offerId, status: "accepted" },
      { status: "pending" },
    );
  }
}

// ⭐ Releases the seat/join-slot a cancelled booking was holding on its
// ServiceRequest. Never touches a request the owner deliberately set to
// "closed" themselves. A failed release must never block the refund that
// already succeeded, so errors are only logged.
async function releaseServiceRequestSlot(serviceRequestId, customerId) {
  if (!serviceRequestId) return;
  try {
    const request = await ServiceRequest.findById(serviceRequestId);
    if (!request || request.status === "closed") return;

    const notExpired = !request.expiresAt || new Date(request.expiresAt) > new Date();

    if (request.requestMode === "free_single") {
      if (request.joinedBy && String(request.joinedBy) === String(customerId)) {
        request.joinedBy = null;
        if (request.status === "fulfilled" && notExpired) {
          request.status = "open";
        }
        await request.save();
      }
      return;
    }

    // paid_fixed / paid_offer / free_group — all use the seatsBooked counter.
    request.seatsBooked = Math.max(0, (request.seatsBooked || 0) - 1);
    if (
      request.status === "fulfilled" &&
      request.seatsBooked < request.numberOfParticipants &&
      notExpired
    ) {
      request.status = "open";
    }
    await request.save();
  } catch (err) {
    console.error("releaseServiceRequestSlot error:", err);
  }
}

// A pending checkout the customer never finished. Checks Stripe first — if
// money is (or may be) moving, it is NOT released. Returns true if released.
// keepSeat: the caller is retrying the same seat/offer, so the seat passes to
// the new checkout instead of being given back.
async function releaseIfAbandoned(payment, { keepSeat }) {
  try {
    let intentId = payment.paymentIntentId;
    let session = null;
    if (payment.checkoutSessionId) {
      session = await stripe.checkout.sessions.retrieve(payment.checkoutSessionId);
      intentId = intentId || session.payment_intent || null;
    }

    if (intentId) {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      const abandoned = [
        "requires_payment_method",
        "requires_action",
        "canceled",
      ].includes(intent.status);
      if (!abandoned) return false;
      payment.paymentIntentId = intentId;
    }

    // Close the old Stripe page so it can't be paid after we've moved on.
    if (session?.status === "open") {
      await stripe.checkout.sessions
        .expire(payment.checkoutSessionId)
        .catch((err) => logError("releaseIfAbandoned:expireSession", err));
    }

    payment.status = "canceled";
    payment.failureReason = "Checkout abandoned by customer — released to allow rebooking";
    await payment.save();

    await releaseReservedWalletCoins(payment.user, payment.walletCoinsUsed);
    if (!keepSeat) {
      await releaseSeatAndOffer(payment.serviceRequest, payment.serviceRequestOffer);
    }
    log("releaseIfAbandoned:released", { paymentId: payment._id, keepSeat });
    return true;
  } catch (err) {
    logError("releaseIfAbandoned", err);
    return false;
  }
}

// =====================================================================
// 1) CHECKOUT — called by serviceRequestController.bookFixedRequest and
// acceptOffer after they've validated the request and locked the seat.
// req.body: userId, providerId, serviceRequestId, offerId?, phone,
// location_name?, latitude?, longitude?, useWallet?, _seatReserved
// (_seatReserved = the caller locked a seat/offer just for this call; it's
// handed back if the customer can't be sent to Stripe).
// =====================================================================
exports.createRequestCheckout = async (req, res) => {
  const {
    userId,
    providerId,
    serviceRequestId,
    offerId,
    phone,
    location_name,
    latitude,
    longitude,
    useWallet = false,
    _seatReserved = false,
  } = req.body;

  let checkoutCreated = false;
  const fail = async (status, body) => {
    if (_seatReserved && !checkoutCreated) {
      await releaseSeatAndOffer(serviceRequestId, offerId).catch((err) =>
        logError("createRequestCheckout:undoReservation", err),
      );
    }
    return res.status(status).json(body);
  };

  try {
    log("createRequestCheckout:start", { userId, providerId, serviceRequestId, offerId });

    if (!userId || !providerId || !serviceRequestId) {
      return fail(400, { isSuccess: false, message: "Missing required data" });
    }
    if (String(userId) === String(providerId)) {
      return fail(400, { isSuccess: false, message: "You cannot book your own request" });
    }
    if (!phone) {
      return fail(400, { isSuccess: false, message: "Phone number is required" });
    }

    const [customer, provider, request, offer] = await Promise.all([
      User.findById(userId),
      User.findById(providerId),
      ServiceRequest.findById(serviceRequestId),
      offerId ? ServiceRequestOffer.findById(offerId) : null,
    ]);
    if (!customer || !provider || !request || (offerId && !offer)) {
      return fail(404, { isSuccess: false, message: "Data not found" });
    }
    if (!provider.stripeAccountId) {
      return fail(400, { isSuccess: false, message: "Provider stripe account missing" });
    }

    // paid_offer → the accepted Offer's price and policy; paid_fixed → the
    // request's own fixed price and policy.
    const amount = Number(offer ? offer.amount : request.budget?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(400, { isSuccess: false, message: "Invalid booking amount" });
    }
    const cancellationPolicy =
      (offer ? offer.cancellationPolicy : request.cancellationPolicy) || "late_fee";
    const currency = (
      offer?.currency ||
      request.budget?.currency ||
      "EUR"
    ).toLowerCase();

    if (!customer.mobile) {
      customer.mobile = phone;
      await customer.save();
    }
    const bookingLocation =
      latitude && longitude
        ? { type: "Point", coordinates: [Number(longitude), Number(latitude)] }
        : null;

    // 🚫 Block a double payment — unless the earlier checkout was abandoned.
    const existingPayment = await Payment.findOne({
      user: userId,
      provider: providerId,
      serviceRequest: serviceRequestId,
      status: { $in: ["pending", "held"] },
    });
    if (existingPayment) {
      const sameSeat =
        String(existingPayment.serviceRequestOffer || "") === String(offerId || "");
      const released =
        existingPayment.status === "pending" &&
        (await releaseIfAbandoned(existingPayment, { keepSeat: sameSeat }));
      if (!released) {
        return fail(400, {
          isSuccess: false,
          message: "Payment already in progress. Please do not pay again.",
          paymentId: existingPayment._id,
        });
      }
    }

    const { providerCommissionPercent, customerCommissionPercent } =
      await getCommissionPercents();
    const split = splitCommission(amount, providerCommissionPercent, customerCommissionPercent);

    let wallet = null;
    let walletCoinsUsed = 0;
    let walletAmountUsed = 0;
    let customerPayable = split.customerPayable;
    let platformContribution = 0;
    if (useWallet === true || useWallet === "true") {
      const redemption = await calculateWalletRedemption({
        userId,
        amount,
        providerAmount: split.providerAmount,
        customerCommissionAmount: split.customerCommissionAmount,
      });
      ({ wallet, walletCoinsUsed, walletAmountUsed, customerPayable, platformContribution } =
        redemption);
    }

    const customerStripeId = await getOrCreateStripeCustomer(customer);
    const serviceStartAt = serviceStartFromRequest(request);

    const metadata = {
      event: "service_request_booking",
      customerId: customer._id.toString(),
      providerId: provider._id.toString(),
      serviceRequestId: request._id.toString(),
      ...(offer && { offerId: offer._id.toString() }),
      customerName: customer.name || "",
      providerName: provider.name || "",
      serviceTitle: request.title || "",
      customerEmail: customer.email || "",
      providerEmail: provider.email || "",
      currency,
      serviceAmount: amount.toString(),
      providerAmount: split.providerAmount.toString(),
      providerCommission: split.providerCommissionAmount.toString(),
      customerCommission: split.customerCommissionAmount.toString(),
      totalPaidByCustomer: customerPayable.toString(),
      useWallet: String(walletCoinsUsed > 0),
      walletCoinsUsed: walletCoinsUsed.toString(),
      walletAmountUsed: walletAmountUsed.toString(),
      cancellationPolicy,
    };

    // ⭐ Automatic capture — charged now, held on the platform until
    // completeRequestBooking() transfers the provider's share.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerStripeId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: request.title,
              description: request.description || "No description",
            },
            unit_amount: Math.round(customerPayable * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        event: "service_request_booking",
        serviceRequestId: metadata.serviceRequestId,
        ...(offer && { offerId: metadata.offerId }),
      },
      payment_intent_data: { metadata },
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
    });
    checkoutCreated = true;

    const payment = await Payment.create({
      user: userId,
      provider: providerId,
      serviceRequest: serviceRequestId,
      ...(offer && { serviceRequestOffer: offer._id }),
      checkoutSessionId: session.id,
      customerStripeId,
      providerStripeId: provider.stripeAccountId,
      amount: customerPayable,
      currency,
      originalAmount: amount,
      initialServiceAmount: amount,
      walletCoinsUsed,
      walletAmountUsed,
      customerPaidAmount: customerPayable,
      platformContribution,
      usedWallet: walletCoinsUsed > 0,
      appCommission: round2(split.providerCommissionAmount + split.customerCommissionAmount),
      providerCommissionPercentage: providerCommissionPercent,
      customerCommissionPercentage: customerCommissionPercent,
      providerCommissionAmount: split.providerCommissionAmount,
      customerCommissionAmount: split.customerCommissionAmount,
      totalPaidByCustomer: customerPayable,
      providerAmount: split.providerAmount,
      paymentIntentId: session.payment_intent,
      status: "pending",
      contactPhone: phone,
      location_name: location_name || null,
      ...(bookingLocation && { location: bookingLocation }),
      cancellationPolicy,
      serviceStartAt,
    });

    if (walletCoinsUsed > 0 && wallet) {
      wallet.reservedPoints = (wallet.reservedPoints || 0) + walletCoinsUsed;
      await wallet.save();
    }

    log("createRequestCheckout:success", { paymentId: payment._id, sessionId: session.id });
    return res.json({
      isSuccess: true,
      redirectUrl: session.url,
      paymentId: payment._id,
      cancellationPolicy,
    });
  } catch (err) {
    logError("createRequestCheckout:error", err);
    return fail(500, { isSuccess: false, message: err.message });
  }
};

// Creates the Booking once Stripe confirms the first payment (webhook or the
// reconciliation cron). Returns the Booking, or null if it can't be created.
async function createRequestBooking(payment, paymentIntent) {
  const customerId = paymentIntent.metadata?.customerId || payment.user;
  const providerId = paymentIntent.metadata?.providerId || payment.provider;
  const [customer, provider, request] = await Promise.all([
    User.findById(customerId),
    User.findById(providerId),
    ServiceRequest.findById(payment.serviceRequest).select("title"),
  ]);
  if (!customer || !provider) return null;

  const booking = await Booking.create({
    customer: customer._id,
    provider: provider._id,
    serviceRequest: payment.serviceRequest,
    amount: payment.originalAmount,
    initialAmount: payment.initialServiceAmount ?? payment.originalAmount,
    paymentId: payment._id,
    status: "booked",
    contactPhone: payment.contactPhone,
    location_name: payment.location_name,
    ...(payment.location?.coordinates?.length && { location: payment.location }),
    cancellationPolicy: payment.cancellationPolicy || "late_fee",
    serviceStartAt: payment.serviceStartAt || null,
  });

  payment.status = "held";
  payment.bookingId = booking._id;
  payment.paymentIntentId = paymentIntent.id;
  payment.customerStripeId = paymentIntent.customer || payment.customerStripeId;
  payment.heldAt = new Date();
  await payment.save();

  // Tag the first charge with the same group id the later difference
  // payments, refunds and the provider transfer carry.
  stripe.paymentIntents
    .update(paymentIntent.id, {
      metadata: {
        bookingId: booking._id.toString(),
        paymentId: payment._id.toString(),
        paymentGroup: payment._id.toString(),
        chargeRole: "initial",
      },
    })
    .catch((err) => logError("createRequestBooking:tagIntent", err));

  if (request) {
    sendBookingNotification(
      customer,
      provider,
      { _id: request._id, title: request.title },
      booking,
    ).catch((err) => logError("createRequestBooking:notification", err));
  }
  return booking;
}

// =====================================================================
// 2) QUOTATION CHANGE — provider proposes a higher price after the job has
// started; the customer pays ONLY the difference through its own Checkout.
// The full history lives on the Booking (booking.quotationChanges); every
// paid difference is also listed on the Payment (payment.additionalCharges).
// =====================================================================
const openQuotationChange = (booking) =>
  (booking.quotationChanges || []).find((q) => OPEN_QUOTATION_STATUSES.includes(q.status));

// Atomically updates one booking.quotationChanges entry, only while it is
// still in one of `fromStatuses` — so two requests/webhooks can never both
// move it. Returns the updated Booking, or null if it had already moved on.
function updateQuotationChange(bookingId, quotationChangeId, fromStatuses, fields) {
  const set = {};
  for (const [key, value] of Object.entries(fields)) {
    set[`quotationChanges.$.${key}`] = value;
  }
  return Booking.findOneAndUpdate(
    {
      _id: bookingId,
      quotationChanges: {
        $elemMatch: { _id: quotationChangeId, status: { $in: fromStatuses } },
      },
    },
    { $set: set },
    { new: true },
  );
}

exports.createQuotationChange = async (req, res) => {
  try {
    const providerId = req.user?.id;
    if (!providerId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }
    const { bookingId } = req.params;
    const { proposedAmount, reason } = req.body;

    const amountNum = Number(proposedAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        isSuccess: false,
        message: "A positive proposedAmount is required",
      });
    }
    // Required per the client's risk-mitigation decision (24 Sep 2026).
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ isSuccess: false, message: "A reason is required" });
    }

    const booking = await Booking.findById(bookingId).populate(
      "serviceRequest",
      "requestMode",
    );
    if (!booking) {
      return res.status(404).json({ isSuccess: false, message: "Booking not found" });
    }
    if (String(booking.provider) !== String(providerId)) {
      return res.status(403).json({
        isSuccess: false,
        message: "You can only propose a change on your own booking",
      });
    }
    if (!booking.serviceRequest || booking.serviceRequest.requestMode !== "paid_offer") {
      return res.status(400).json({
        isSuccess: false,
        message: "A price change is only possible on an accepted-offer booking",
      });
    }
    // The job must already be in progress (OTP verified).
    if (booking.status !== "started") {
      return res.status(400).json({
        isSuccess: false,
        message:
          "A price change can only be proposed once the service has started (OTP verified)",
      });
    }

    const payment = await Payment.findById(booking.paymentId);
    if (!payment) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Payment not found for this booking" });
    }
    if (amountNum <= payment.originalAmount) {
      return res.status(400).json({
        isSuccess: false,
        message: "Proposed amount must be higher than the current amount",
      });
    }

    // Added only if no other change is still open (atomic, so a double tap
    // can't create two).
    const quotationChangeId = new mongoose.Types.ObjectId();
    const updated = await Booking.findOneAndUpdate(
      {
        _id: booking._id,
        "quotationChanges.status": { $nin: OPEN_QUOTATION_STATUSES },
      },
      {
        $push: {
          quotationChanges: {
            _id: quotationChangeId,
            provider: providerId,
            previousAmount: payment.originalAmount,
            proposedAmount: amountNum,
            reason: String(reason).trim(),
            currency: payment.currency,
          },
        },
      },
      { new: true },
    );
    if (!updated) {
      return res.status(400).json({
        isSuccess: false,
        message: "A price change is already pending for this booking",
      });
    }
    const quotationChange = updated.quotationChanges.id(quotationChangeId);

    notifyQuotationChangeSubmitted(quotationChange, updated).catch((err) =>
      logError("createQuotationChange:notify", err),
    );

    return res.status(201).json({
      isSuccess: true,
      message: "Quotation change submitted",
      data: quotationChange,
    });
  } catch (err) {
    logError("createQuotationChange:error", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// decision "accept" → returns a Stripe Checkout redirectUrl for the
// difference (calling accept again while unpaid returns the same/a fresh
// link). decision "reject" → closes it (also cancels an unpaid link).
exports.respondToQuotationChange = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }
    const { bookingId, id } = req.params;
    const { decision } = req.body;
    if (!["accept", "reject"].includes(decision)) {
      return res
        .status(400)
        .json({ isSuccess: false, message: "decision must be accept or reject" });
    }

    const booking = await Booking.findById(bookingId).populate(
      "serviceRequest",
      "title",
    );
    if (!booking) {
      return res.status(404).json({ isSuccess: false, message: "Booking not found" });
    }
    if (String(booking.customer) !== String(customerId)) {
      return res.status(403).json({
        isSuccess: false,
        message: "You can only respond to a change on your own booking",
      });
    }

    const quotationChange = booking.quotationChanges.id(id);
    if (!quotationChange) {
      return res
        .status(404)
        .json({ isSuccess: false, message: "Quotation change not found" });
    }
    if (!OPEN_QUOTATION_STATUSES.includes(quotationChange.status)) {
      return res.status(400).json({
        isSuccess: false,
        message: "This quotation change has already been responded to",
      });
    }
    if (booking.status !== "started") {
      return res.status(400).json({
        isSuccess: false,
        message: "This booking is no longer in progress",
      });
    }

    const payment = await Payment.findById(booking.paymentId);
    if (!payment) {
      return res.status(404).json({ isSuccess: false, message: "Payment not found" });
    }

    if (decision === "reject") {
      if (quotationChange.checkoutSessionId) {
        await stripe.checkout.sessions
          .expire(quotationChange.checkoutSessionId)
          .catch(() => {}); // already expired/completed — nothing to close
      }
      const updated = await updateQuotationChange(
        booking._id,
        quotationChange._id,
        OPEN_QUOTATION_STATUSES,
        { status: "rejected", respondedAt: new Date() },
      );
      if (!updated) {
        return res.status(400).json({
          isSuccess: false,
          message: "This quotation change has already been responded to",
        });
      }
      const rejected = updated.quotationChanges.id(quotationChange._id);
      notifyQuotationChangeResponded(rejected, updated).catch((err) =>
        logError("respondToQuotationChange:notify", err),
      );
      return res.json({
        isSuccess: true,
        message: "Quotation change rejected",
        data: rejected,
      });
    }

    // ===== ACCEPT: customer pays only the difference =====
    // Re-use a still-open payment link instead of creating a second one.
    if (quotationChange.status === "awaiting_payment" && quotationChange.checkoutSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        quotationChange.checkoutSessionId,
      );
      if (existingSession.status === "open") {
        return res.json({
          isSuccess: true,
          message: "Pay the price difference to confirm the new price",
          redirectUrl: existingSession.url,
          amountToPay: quotationChange.customerPayable,
          currency: quotationChange.currency,
          data: quotationChange,
        });
      }
    }

    const delta = round2(quotationChange.proposedAmount - payment.originalAmount);
    if (delta <= 0) {
      return res.status(400).json({
        isSuccess: false,
        message: "Proposed amount must be higher than the current amount",
      });
    }

    // Commission % from the admin's CommissionSetting, on the difference only.
    const { providerCommissionPercent, customerCommissionPercent } =
      await getCommissionPercents();
    const split = splitCommission(delta, providerCommissionPercent, customerCommissionPercent);

    const groupMeta = {
      event: "quotation_change_payment",
      chargeRole: "quotation_change",
      paymentGroup: payment._id.toString(),
      paymentId: payment._id.toString(),
      bookingId: booking._id.toString(),
      quotationChangeId: quotationChange._id.toString(),
      serviceRequestId: String(booking.serviceRequest?._id || booking.serviceRequest || ""),
      rootPaymentIntentId: payment.paymentIntentId || "",
      customerId: String(booking.customer),
      providerId: String(booking.provider),
      serviceTitle: booking.serviceRequest?.title || "",
      currency: payment.currency,
      previousAmount: String(payment.originalAmount),
      proposedAmount: String(quotationChange.proposedAmount),
      deltaAmount: String(delta),
      totalPaidByCustomer: String(split.customerPayable),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: payment.customerStripeId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: payment.currency,
            product_data: {
              name: `Price update: ${booking.serviceRequest?.title || "Booking"}`,
              description: `Updated from ${payment.originalAmount} to ${quotationChange.proposedAmount}`,
            },
            unit_amount: Math.round(split.customerPayable * 100),
          },
          quantity: 1,
        },
      ],
      metadata: groupMeta,
      payment_intent_data: { metadata: groupMeta },
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
    });

    const updated = await updateQuotationChange(
      booking._id,
      quotationChange._id,
      OPEN_QUOTATION_STATUSES,
      {
        status: "awaiting_payment",
        respondedAt: new Date(),
        deltaAmount: delta,
        customerPayable: split.customerPayable,
        providerCommissionAmount: split.providerCommissionAmount,
        customerCommissionAmount: split.customerCommissionAmount,
        providerAmount: split.providerAmount,
        currency: payment.currency,
        checkoutSessionId: session.id,
      },
    );
    if (!updated) {
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      return res.status(400).json({
        isSuccess: false,
        message: "This quotation change has already been responded to",
      });
    }

    return res.json({
      isSuccess: true,
      message: "Pay the price difference to confirm the new price",
      redirectUrl: session.url,
      amountToPay: split.customerPayable,
      currency: payment.currency,
      data: updated.quotationChanges.id(quotationChange._id),
    });
  } catch (err) {
    logError("respondToQuotationChange:error", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

// The difference was paid — add it to the booking/payment totals. Safe to
// call more than once for the same session (webhook retries, cron).
async function applyQuotationPayment(session) {
  if (session.payment_status !== "paid") return;
  const { bookingId, quotationChangeId } = session.metadata || {};
  const booking = await Booking.findById(bookingId);
  const change = booking?.quotationChanges.id(quotationChangeId);
  if (!change || change.status === "accepted") return;

  // Claim it: only one caller can move awaiting_payment → accepted.
  const claimed =
    booking.status === "started" &&
    (await updateQuotationChange(bookingId, quotationChangeId, ["awaiting_payment"], {
      status: "accepted",
      paidAt: new Date(),
      paymentIntentId: session.payment_intent,
    }));

  if (!claimed) {
    // Paid after the change was dropped (rejected / booking cancelled) —
    // nothing to apply it to, so give the money straight back.
    const fresh = await Booking.findById(bookingId);
    const freshChange = fresh?.quotationChanges.id(quotationChangeId);
    if (!freshChange || freshChange.status === "accepted" || freshChange.refundedAmount > 0) {
      return;
    }
    try {
      const refund = await stripe.refunds.create({
        payment_intent: session.payment_intent,
        reason: "requested_by_customer",
        metadata: {
          event: "quotation_change_auto_refund",
          paymentGroup: String(booking.paymentId),
          bookingId: String(bookingId),
          quotationChangeId: String(quotationChangeId),
        },
      });
      await updateQuotationChange(
        bookingId,
        quotationChangeId,
        ["pending", "awaiting_payment", "rejected", "cancelled"],
        { paymentIntentId: session.payment_intent, refundedAmount: freshChange.customerPayable },
      );
      log("applyQuotationPayment:autoRefunded", { quotationChangeId, refundId: refund.id });
    } catch (err) {
      logError("applyQuotationPayment:autoRefundFailed — NEEDS MANUAL FOLLOW-UP", err);
    }
    return;
  }

  const payment = await Payment.findById(booking.paymentId);
  payment.originalAmount = round2(payment.originalAmount + change.deltaAmount);
  payment.quotationAdjustmentAmount = round2(
    (payment.quotationAdjustmentAmount || 0) + change.deltaAmount,
  );
  payment.customerPaidAmount = round2((payment.customerPaidAmount || 0) + change.customerPayable);
  payment.totalPaidByCustomer = payment.customerPaidAmount;
  payment.providerAmount = round2(payment.providerAmount + change.providerAmount);
  payment.providerCommissionAmount = round2(
    (payment.providerCommissionAmount || 0) + change.providerCommissionAmount,
  );
  payment.customerCommissionAmount = round2(
    (payment.customerCommissionAmount || 0) + change.customerCommissionAmount,
  );
  payment.appCommission = round2(
    payment.providerCommissionAmount + payment.customerCommissionAmount,
  );
  payment.additionalCharges.push({
    quotationChange: change._id,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent,
    serviceAmount: change.deltaAmount,
    customerPaidAmount: change.customerPayable,
    providerAmount: change.providerAmount,
    providerCommissionAmount: change.providerCommissionAmount,
    customerCommissionAmount: change.customerCommissionAmount,
  });
  await payment.save();

  await Booking.updateOne({ _id: bookingId }, { $set: { amount: payment.originalAmount } });

  const accepted = claimed.quotationChanges.id(quotationChangeId);
  notifyQuotationChangeResponded(accepted, claimed).catch((err) =>
    logError("applyQuotationPayment:notify", err),
  );
  log("applyQuotationPayment:applied", {
    quotationChangeId,
    newTotal: payment.originalAmount,
  });
}

// =====================================================================
// 3) STRIPE WEBHOOK HOOKS — paymentController.stripeWebhook calls these
// first; they return true when the event belonged to a request booking.
// =====================================================================
exports.handleCheckoutSessionCompleted = async (session) => {
  if (session.metadata?.event === "quotation_change_payment") {
    await applyQuotationPayment(session);
    return true;
  }

  const payment = await Payment.findOne({ checkoutSessionId: session.id });
  if (!payment || !payment.serviceRequest) return false;
  if (payment.status === "held" || payment.bookingId) return true;
  if (await Booking.exists({ paymentId: payment._id })) return true;

  const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
  if (paymentIntent.status !== "succeeded") return true;

  // The checkout was released as abandoned (seat may already be someone
  // else's) but the customer paid on the old page anyway — refund in full.
  if (payment.status !== "pending") {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent.id,
      reason: "requested_by_customer",
      metadata: {
        event: "released_checkout_auto_refund",
        paymentGroup: payment._id.toString(),
        paymentId: payment._id.toString(),
      },
    });
    payment.paymentIntentId = paymentIntent.id;
    payment.status = "refunded";
    payment.refundId = refund.id;
    payment.refundStatus = refund.status;
    payment.refundedAmount = payment.customerPaidAmount;
    payment.refundReason = "Paid on a checkout that had already been released";
    payment.refundedAt = new Date();
    await payment.save();
    log("handleCheckoutSessionCompleted:lateAutoRefund", { paymentId: payment._id });
    return true;
  }

  const booking = await createRequestBooking(payment, paymentIntent);
  log("handleCheckoutSessionCompleted:bookingCreated", { bookingId: booking?._id });
  return true;
};

// Customer left the Stripe page until it expired (24h) — free the seat.
exports.handleCheckoutSessionExpired = async (session) => {
  if (session.metadata?.event === "quotation_change_payment") {
    // Stays awaiting_payment — the customer can accept again for a new link.
    return true;
  }
  const payment = await Payment.findOne({ checkoutSessionId: session.id });
  if (!payment || !payment.serviceRequest) return false;
  if (payment.status === "pending") {
    await releaseIfAbandoned(payment, { keepSeat: false });
  }
  return true;
};

// =====================================================================
// 4) COMPLETE — one transfer to the provider for the full total.
// paymentController.completeService forwards request bookings here.
// =====================================================================
exports.completeRequestBooking = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId)
      .populate("customer")
      .populate("provider")
      .populate("serviceRequest", "title isFree location_name");

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if (booking.status === "completed") {
      return res.json({ isSuccess: true, message: "Service already completed" });
    }

    const { customer, provider } = booking;
    const subject = bookingSubject(booking);

    // Free join (free_single / free_group) — nothing to pay out.
    if (booking.amount === 0 || subject?.isFree) {
      booking.status = "completed";
      await booking.save();
      await updateProviderPerformance(provider._id, 1, 0);
      await sendServiceCompletedEmail(customer, provider, subject, booking);
      await sendServiceCompletedNotification(customer, provider, subject, booking);
      return res.json({ isSuccess: true, message: "Free service completed successfully" });
    }

    if (booking.status !== "started") {
      return res.status(400).json({
        isSuccess: false,
        message: "Please start the service first by verifying OTP.",
      });
    }

    // Don't pay out at the old price while a price change is unresolved.
    const openChange = openQuotationChange(booking);
    if (openChange) {
      return res.status(400).json({
        isSuccess: false,
        message:
          openChange.status === "awaiting_payment"
            ? "The customer hasn't paid the updated price yet"
            : "A price change is still waiting for the customer's answer",
      });
    }

    const payment = await Payment.findById(booking.paymentId);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    if (payment.status === "completed") {
      return res.json({ isSuccess: true, message: "Payment already completed" });
    }

    // Older bookings may have been authorized only — capture if so.
    const paymentIntent = await stripe.paymentIntents.retrieve(payment.paymentIntentId);
    if (paymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.capture(payment.paymentIntentId);
    }

    const paidChanges = booking.quotationChanges.filter((q) => q.status === "accepted");

    // ⭐ ONE transfer for the full total (original + every paid difference).
    let transferStatus = "pending";
    let transferId = null;
    try {
      const transfer = await stripe.transfers.create({
        amount: Math.round(payment.providerAmount * 100),
        currency: payment.currency,
        destination: provider.stripeAccountId,
        transfer_group: booking._id.toString(),
        metadata: {
          event: "provider_payout",
          paymentGroup: payment._id.toString(),
          paymentId: payment._id.toString(),
          bookingId: booking._id.toString(),
          serviceRequestId: String(subject?._id || ""),
          serviceTitle: subject?.title || "",
          customerId: customer._id.toString(),
          customerName: customer.name || "",
          providerId: provider._id.toString(),
          providerName: provider.name || "",
          transferReason: "Service request completed",
          amount: payment.providerAmount.toString(),
          currency: payment.currency,
          paymentIntentIds: [payment.paymentIntentId, ...paidChanges.map((q) => q.paymentIntentId)]
            .filter(Boolean)
            .join(","),
          quotationChangeIds: paidChanges.map((q) => q._id.toString()).join(","),
        },
      });
      transferStatus = "completed";
      transferId = transfer.id;
    } catch (transferError) {
      transferStatus = "failed";
      payment.transferFailureReason = transferError.message;
      payment.transferFailureCode = transferError.code || null;
      logError("completeRequestBooking:transfer", transferError);
    }

    if (payment.usedWallet && payment.walletCoinsUsed > 0) {
      await spendReservedWalletCoins(customer, payment.walletCoinsUsed);
    }

    booking.status = "completed";
    await booking.save();

    // The job is done — the request no longer needs another provider, so
    // decline any offers that were left pending (client decision, 30 Sep).
    try {
      const requestId = booking.serviceRequest?._id || booking.serviceRequest;
      const stillPendingOffers = await ServiceRequestOffer.find({
        request: requestId,
        status: "pending",
      });
      if (stillPendingOffers.length) {
        await ServiceRequestOffer.updateMany(
          { request: requestId, status: "pending" },
          { status: "declined" },
        );
        const requestDoc = await ServiceRequest.findById(requestId).select("title owner");
        if (requestDoc) {
          stillPendingOffers.forEach((declinedOffer) => {
            notifyOfferDeclined(requestDoc, declinedOffer).catch((err) =>
              logError("completeRequestBooking:notifyOfferDeclined", err),
            );
          });
        }
      }
    } catch (err) {
      logError("completeRequestBooking:declineRemainingOffers", err);
    }

    payment.status = "completed";
    payment.completedAt = new Date();
    payment.transferStatus = transferStatus;
    payment.transferId = transferId;
    payment.transferAmount = payment.providerAmount;
    payment.transferDestination = provider.stripeAccountId;
    await payment.save();
    // No ambassador commission on Service Request bookings.

    await updateProviderPerformance(provider._id, 1, 0);
    await sendServiceCompletedEmail(customer, provider, subject, booking);
    await sendServiceCompletedNotification(customer, provider, subject, booking);

    log("completeRequestBooking:done", { bookingId: booking._id, transferId });
    return res.json({ isSuccess: true, message: "Service completed & payment captured" });
  } catch (err) {
    logError("completeRequestBooking:error", err);
    return res.status(500).json({ message: err.message });
  }
};

// =====================================================================
// 5) CANCEL + REFUND — paymentController.refundBooking forwards request
// bookings here (customer, provider and the admin report "refund" action).
//   • provider cancels → full refund, provider performance down
//   • customer cancels, policy "free", or "late_fee" but more than 1h before
//     the start → full refund, nobody keeps anything
//   • customer cancels, policy "late_fee", within 1h of the start →
//     CommissionSetting.requestLateCancellationPercentage of the amount is
//     kept; BeTogether keeps requestLateCancellationAdminSharePercentage of
//     that, the provider gets the rest
// The refund is spread across every charge of the booking (original +
// paid differences), newest first, all tagged with the same paymentGroup.
// =====================================================================
exports.cancelRequestBooking = async (req, res) => {
  try {
    const { bookingId, cancelledBy, reason } = req.body;
    const booking = await Booking.findById(bookingId)
      .populate("customer")
      .populate("provider")
      .populate("serviceRequest", "title isFree location_name schedule");

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if (booking.status === "completed") {
      return res.status(400).json({
        isSuccess: false,
        message: "Service already completed. Cancellation not allowed.",
      });
    }
    if (booking.status === "started") {
      // Narrow exception (client-finalized 24 Sep 2026): the provider may
      // drop the job if the customer rejected their price change.
      const rejectedChange =
        cancelledBy === "provider" &&
        booking.quotationChanges.some((q) => q.status === "rejected");
      if (!rejectedChange) {
        return res.status(400).json({
          isSuccess: false,
          message: "Service already started. Cancellation not allowed.",
        });
      }
    } else if (booking.status !== "booked") {
      return res.status(400).json({
        isSuccess: false,
        message: "Only booked services can be cancelled.",
      });
    }

    const subject = bookingSubject(booking);
    const whoCancelled = cancelledBy || "customer";

    const notifyCancellation = async () => {
      try {
        await sendServiceCancelledEmail(
          booking.customer,
          booking.provider,
          subject,
          booking,
          reason,
        );
      } catch (err) {
        logError("cancelRequestBooking:email", err);
      }
      try {
        await sendServiceCancelledNotification(
          booking.customer,
          booking.provider,
          subject,
          booking,
          reason || "",
        );
      } catch (err) {
        logError("cancelRequestBooking:notification", err);
      }
    };

    // ---------- Free join (free_single / free_group) ----------
    if (booking.amount === 0) {
      booking.status = "cancelled";
      booking.cancelledBy = whoCancelled;
      booking.cancelReason = reason || null;
      booking.cancellationFee = 0;
      booking.refundAmount = 0;
      await booking.save();
      await releaseServiceRequestSlot(booking.serviceRequest, booking.customer._id);
      if (cancelledBy === "provider") {
        await updateProviderPerformance(booking.provider._id, 0, 1);
      }
      await notifyCancellation();
      return res.json({
        isSuccess: true,
        message: "Free service cancelled successfully",
        cancelledBy: booking.cancelledBy,
        reason: booking.cancelReason,
      });
    }

    // ---------- Paid ----------
    let payment = await Payment.findById(booking.paymentId);
    if (!payment) payment = await Payment.findOne({ bookingId });
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // An unpaid price-change link can't be paid any more.
    for (const change of booking.quotationChanges) {
      if (!OPEN_QUOTATION_STATUSES.includes(change.status)) continue;
      if (change.checkoutSessionId) {
        await stripe.checkout.sessions.expire(change.checkoutSessionId).catch(() => {});
      }
      change.status = "cancelled";
    }

    // Every charge of this booking, with what's still refundable on it
    // (read from Stripe, so an earlier partial attempt is never refunded twice).
    const paidChanges = booking.quotationChanges
      .filter((q) => q.status === "accepted" && q.paymentIntentId)
      .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
    const chargeSources = [
      ...paidChanges.map((q) => ({ paymentIntentId: q.paymentIntentId, quotationChange: q })),
      { paymentIntentId: payment.paymentIntentId, quotationChange: null },
    ].filter((source) => source.paymentIntentId);
    const charges = [];
    for (const source of chargeSources) {
      let intent = await stripe.paymentIntents.retrieve(source.paymentIntentId, {
        expand: ["latest_charge"],
      });
      if (intent.status === "requires_capture") {
        intent = await stripe.paymentIntents.capture(source.paymentIntentId, {
          expand: ["latest_charge"],
        });
      }
      const charge = intent.latest_charge;
      const refundable = charge ? (charge.amount - charge.amount_refunded) / 100 : 0;
      if (refundable > 0) charges.push({ ...source, refundable: round2(refundable) });
    }
    const totalRefundable = round2(charges.reduce((sum, c) => sum + c.refundable, 0));

    // ---------- Cancellation fee ----------
    const policy = booking.cancellationPolicy || payment.cancellationPolicy || "late_fee";
    const startAt =
      booking.serviceStartAt ||
      payment.serviceStartAt ||
      serviceStartFromRequest(booking.serviceRequest);
    const isLate =
      cancelledBy !== "provider" &&
      policy === "late_fee" &&
      Boolean(startAt) &&
      Date.now() > new Date(startAt).getTime() - LATE_CANCEL_WINDOW_MS;

    let cancellationFee = 0;
    let adminShare = 0;
    let providerShare = 0;
    if (isLate) {
      // Both % set by the admin in CommissionSetting: how much of the
      // service amount is kept, and BeTogether's share of what's kept.
      const setting = await CommissionSetting.findOne();
      const feePercent = setting?.requestLateCancellationPercentage || 0;
      const adminPercent = setting?.requestLateCancellationAdminSharePercentage || 0;
      cancellationFee = Math.min(
        round2((payment.originalAmount * feePercent) / 100),
        totalRefundable,
      );
      adminShare = round2((cancellationFee * adminPercent) / 100);
      providerShare = round2(cancellationFee - adminShare);
    }
    const refundAmount = round2(totalRefundable - cancellationFee);
    log("cancelRequestBooking:amounts", {
      bookingId,
      policy,
      isLate,
      totalRefundable,
      cancellationFee,
      adminShare,
      providerShare,
      refundAmount,
    });

    // ---------- Refund across the charges ----------
    const refunds = [];
    let remaining = refundAmount;
    try {
      for (const charge of charges) {
        if (remaining <= 0) break;
        const amount = round2(Math.min(remaining, charge.refundable));
        const refund = await stripe.refunds.create({
          payment_intent: charge.paymentIntentId,
          amount: Math.round(amount * 100),
          reason: "requested_by_customer",
          metadata: {
            event: "request_booking_refund",
            paymentGroup: payment._id.toString(),
            paymentId: payment._id.toString(),
            bookingId: booking._id.toString(),
            serviceRequestId: String(subject?._id || ""),
            chargeRole: charge.quotationChange ? "quotation_change" : "initial",
            ...(charge.quotationChange && {
              quotationChangeId: charge.quotationChange._id.toString(),
            }),
            cancelledBy: whoCancelled,
            cancellationReason: reason || "No Reason",
            totalRefundAmount: refundAmount.toString(),
            cancellationFee: cancellationFee.toString(),
          },
        });
        refunds.push({
          refundId: refund.id,
          paymentIntentId: charge.paymentIntentId,
          quotationChange: charge.quotationChange?._id || null,
          amount,
          status: refund.status,
        });
        if (charge.quotationChange) {
          charge.quotationChange.refundedAmount = round2(
            (charge.quotationChange.refundedAmount || 0) + amount,
          );
        }
        remaining = round2(remaining - amount);
      }
    } catch (refundErr) {
      // Keep a record of whatever did go through; a retry only refunds
      // what's still refundable on Stripe.
      payment.refunds.push(...refunds);
      await payment.save();
      await booking.save(); // per-change refundedAmount + closed price changes
      logError("cancelRequestBooking:refundFailed", refundErr);
      return res.status(500).json({
        isSuccess: false,
        message: "Refund could not be completed. Please try again.",
        error: refundErr.message,
      });
    }

    // ---------- Provider's share of a late fee ----------
    let feeTransferId = null;
    if (providerShare > 0) {
      try {
        if (!booking.provider.stripeAccountId) throw new Error("Provider stripe account missing");
        const transfer = await stripe.transfers.create({
          amount: Math.round(providerShare * 100),
          currency: payment.currency,
          destination: booking.provider.stripeAccountId,
          transfer_group: booking._id.toString(),
          metadata: {
            event: "request_cancellation_fee_payout",
            paymentGroup: payment._id.toString(),
            paymentId: payment._id.toString(),
            bookingId: booking._id.toString(),
            cancellationFee: cancellationFee.toString(),
            providerShare: providerShare.toString(),
            adminShare: adminShare.toString(),
          },
        });
        feeTransferId = transfer.id;
        payment.transferStatus = "completed";
      } catch (transferErr) {
        payment.transferStatus = "failed";
        payment.transferFailureReason = transferErr.message;
        payment.transferFailureCode = transferErr.code || null;
        logError("cancelRequestBooking:feeTransfer", transferErr);
      }
      payment.transferId = feeTransferId;
      payment.transferAmount = providerShare;
      payment.transferDestination = booking.provider.stripeAccountId || null;
    }

    // ---------- Save ----------
    booking.status = "cancelled";
    booking.cancelledBy = whoCancelled;
    booking.cancelReason = reason || null;
    booking.cancellationFee = cancellationFee;
    booking.refundAmount = refundAmount;
    await booking.save();
    await releaseServiceRequestSlot(booking.serviceRequest, booking.customer._id);

    if (payment.usedWallet && payment.walletCoinsUsed > 0) {
      await releaseReservedWalletCoins(booking.customer._id, payment.walletCoinsUsed, {
        note: "Wallet coins released after cancellation",
        notifyUser: booking.customer,
      });
    }

    // "refunded" even while Stripe is still processing (refundStatus says
    // so) — never left "pending", which the reconciliation cron would pick up.
    payment.status = "refunded";
    payment.refunds.push(...refunds);
    payment.refundId = refunds[0]?.refundId || payment.refundId;
    payment.refundStatus = refunds.every((r) => r.status === "succeeded")
      ? "succeeded"
      : "pending";
    payment.refundReason =
      cancelledBy === "provider"
        ? "Provider cancelled booking"
        : reason || "Customer cancelled booking";
    payment.refundedAmount = round2((payment.refundedAmount || 0) + refundAmount);
    payment.cancellationFee = cancellationFee;
    payment.cancellationFeeAdminShare = adminShare;
    payment.cancellationFeeProviderShare = providerShare;
    payment.platformRetainedAmount = adminShare;
    payment.refundedAt = new Date();
    await payment.save();

    if (cancelledBy === "provider") {
      await updateProviderPerformance(booking.provider._id, 0, 1);
    }
    await notifyCancellation();

    return res.json({
      isSuccess: true,
      message: "Booking cancelled & refund processed.",
      refundAmount,
      cancellationFee,
      cancellationPolicy: policy,
      lateCancellation: isLate,
      refundId: payment.refundId,
      refundIds: refunds.map((r) => r.refundId),
      cancelledBy: booking.cancelledBy,
      reason: booking.cancelReason,
    });
  } catch (err) {
    logError("cancelRequestBooking:error", err);
    return res.status(500).json({ message: err.message });
  }
};

// =====================================================================
// 6) RECONCILIATION — paymentController's 10-minute cron forwards stuck
// "pending" request payments here (missed webhook safety net).
// =====================================================================
exports.recoverPendingRequestPayment = async (payment) => {
  const tag = `[RequestPaymentReconciliation:${payment._id}]`;
  try {
    if (payment.status !== "pending" || !payment.checkoutSessionId) return;

    const session = await stripe.checkout.sessions.retrieve(payment.checkoutSessionId);
    if (session.status === "expired") {
      await releaseIfAbandoned(payment, { keepSeat: false });
      return;
    }
    if (!session.payment_intent) return;

    const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
    if (paymentIntent.status !== "succeeded") return;

    const existingBooking = await Booking.findOne({ paymentId: payment._id });
    if (existingBooking) {
      payment.status = "held";
      payment.bookingId = existingBooking._id;
      payment.paymentIntentId = paymentIntent.id;
      payment.heldAt = payment.heldAt || new Date();
      await payment.save();
      return;
    }

    const freshPayment = await Payment.findById(payment._id);
    if (!freshPayment || freshPayment.status !== "pending") return;

    const booking = await createRequestBooking(freshPayment, paymentIntent);
    if (booking) {
      console.log(`✅ ${tag} Booking recovered: ${booking._id}`);
      return;
    }

    // Can't create the booking (customer/provider gone) — refund in full.
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent.id,
      reason: "requested_by_customer",
      metadata: {
        event: "reconciliation_auto_refund",
        paymentGroup: freshPayment._id.toString(),
        paymentId: freshPayment._id.toString(),
      },
    });
    await releaseReservedWalletCoins(freshPayment.user, freshPayment.walletCoinsUsed, {
      note: "Wallet coins released — reconciliation auto-refund",
    });
    freshPayment.status = "refunded";
    freshPayment.paymentIntentId = paymentIntent.id;
    freshPayment.refundId = refund.id;
    freshPayment.refundStatus = refund.status;
    freshPayment.refundReason =
      "Auto-refunded by reconciliation job — booking could not be recreated";
    freshPayment.refundedAt = new Date();
    freshPayment.refundedAmount = freshPayment.customerPaidAmount;
    await freshPayment.save();
    await releaseSeatAndOffer(freshPayment.serviceRequest, freshPayment.serviceRequestOffer);
    console.error(`🚨 ${tag} Auto-refund issued: ${refund.id}. NEEDS MANUAL FOLLOW-UP.`);
  } catch (err) {
    console.error(`🚨 ${tag} error:`, err.message);
  }
};

// Every 10 minutes: a price difference the customer paid but whose webhook
// never arrived still gets applied.
cron.schedule("*/10 * * * *", async () => {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const bookings = await Booking.find({
      quotationChanges: {
        $elemMatch: {
          status: "awaiting_payment",
          checkoutSessionId: { $ne: null },
          respondedAt: { $lte: cutoff },
        },
      },
    }).select("quotationChanges");
    for (const booking of bookings) {
      for (const change of booking.quotationChanges) {
        if (change.status !== "awaiting_payment" || !change.checkoutSessionId) continue;
        try {
          const session = await stripe.checkout.sessions.retrieve(change.checkoutSessionId);
          if (session.payment_status === "paid") await applyQuotationPayment(session);
        } catch (err) {
          logError(`quotationReconciliation:${change._id}`, err);
        }
      }
    }
  } catch (err) {
    logError("quotationReconciliation:cron", err);
  }
});

exports.releaseServiceRequestSlot = releaseServiceRequestSlot;
