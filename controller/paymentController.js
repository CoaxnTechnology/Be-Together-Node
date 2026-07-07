const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_PAYMENT_WEBHOOK_SECRET;
console.log("Stripe Webhook Secret:", endpointSecret);
const nodemailer = require("nodemailer");
const {
  sendServiceOtpEmail,
  sendServiceBookedEmail,
  sendServiceCompletedEmail,
  sendServiceCancelledEmail,
} = require("../utils/email");
const ambassadorController = require("./ambassadorController");
const { generateOTP } = require("../utils/otp");
const {
  sendBookingNotification,
  sendServiceStartedNotification,
  sendServiceCompletedNotification,
  sendServiceCancelledNotification,
} = require("../controller/notificationController"); // ✅ import it
const CancellationSetting = require("../model/CancellationSetting");
const User = require("../model/User");
const Service = require("../model/Service");
const Payment = require("../model/Payment");
const Booking = require("../model/Booking");
const CommissionSetting = require("../model/CommissionSetting");
const updateProviderPerformance = require("../utils/providerPerformance");
const Wallet = require("../model/Wallet");
const WalletHistory = require("../model/WalletHistory");
const AdminWalletConfig = require("../model/AdminWalletConfig");
const AmbassadorWallet = require("../model/AmbassadorWallet");
const AmbassadorCommissionSetting = require("../model/AmbassadorCommissionSetting");
const AmbassadorWalletHistory = require("../model/AmbassadorWalletHistory");
const processAmbassadorCommission = require("../services/ambassadorCommissionService");
const logPaymentFlow = (step, data = {}) => {
  console.log(`[paymentController] ${step}`, data);
};

const logPaymentError = (step, err) => {
  console.error(`[paymentController] ${step}`, {
    message: err?.message,
    stack: err?.stack,
  });
};
// -----------------------------
// 1️⃣ Create Stripe Checkout Session (Booking not yet confirmed)
// -----------------------------
exports.bookService = async (req, res) => {
  try {
    logPaymentFlow("bookService:start", {
      body: req.body,
    });
    const {
      userId,
      providerId,
      serviceId,
      phone, // REQUIRED
      location_name, // OPTIONAL
      latitude, // OPTIONAL
      longitude,
      useWallet = false,
    } = req.body;
    // =========================
    // BASIC VALIDATION
    // =========================
    logPaymentFlow("bookService:validateRequiredFields", {
      userId,
      providerId,
      serviceId,
      hasPhone: Boolean(phone),
      useWallet,
    });
    if (!userId || !providerId || !serviceId) {
      logPaymentFlow("bookService:missingRequiredData", {
        userId,
        providerId,
        serviceId,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "Missing required data",
      });
    }
    if (String(userId) === String(providerId)) {
      return res.status(400).json({
        isSuccess: false,
        message: "You cannot book your own service",
      });
    }

    if (!phone) {
      logPaymentFlow("bookService:missingPhone", { userId, serviceId });
      return res.status(400).json({
        isSuccess: false,
        message: "Phone number is required",
      });
    }
    // Data
    logPaymentFlow("bookService:fetchingData", {
      userId,
      providerId,
      serviceId,
    });
    const customer = await User.findById(userId);
    const provider = await User.findById(providerId);
    const serviceDetails = await Service.findById(serviceId);
    logPaymentFlow("bookService:dataFetched", {
      customerFound: Boolean(customer),
      providerFound: Boolean(provider),
      serviceFound: Boolean(serviceDetails),
    });
    if (String(serviceDetails.user) === String(userId)) {
      return res.status(400).json({
        isSuccess: false,
        message: "You cannot book your own service",
      });
    }

    if (!customer || !provider || !serviceDetails) {
      logPaymentFlow("bookService:dataNotFound", {
        customerFound: Boolean(customer),
        providerFound: Boolean(provider),
        serviceFound: Boolean(serviceDetails),
      });
      return res.status(404).json({ message: "Data not found" });
    }

    // ⭐ Always use service currency (NOT provider)
    const currency = serviceDetails.currency?.toLowerCase() || "eur";
    console.log("Booking currency:", currency);
    logPaymentFlow("bookService:serviceCurrency", { currency });
    // =========================
    // SAVE PHONE IN USER PROFILE (ONLY IF EMPTY)
    // =========================
    if (!customer.mobile) {
      logPaymentFlow("bookService:savingCustomerPhone", {
        customerId: customer._id,
      });
      customer.mobile = phone;
      await customer.save();
      logPaymentFlow("bookService:customerPhoneSaved", {
        customerId: customer._id,
      });
    } else {
      logPaymentFlow("bookService:customerPhoneAlreadyExists", {
        customerId: customer._id,
      });
    }

    // =========================
    // PREPARE BOOKING LOCATION (OPTIONAL)
    // =========================
    let bookingLocation = null;
    if (latitude && longitude) {
      bookingLocation = {
        type: "Point",
        coordinates: [Number(longitude), Number(latitude)],
      };
    }
    logPaymentFlow("bookService:bookingLocationPrepared", {
      hasLocation: Boolean(bookingLocation),
      location_name: location_name || null,
      bookingLocation,
    });

    const amount = serviceDetails.isFree ? 0 : serviceDetails.price;
    logPaymentFlow("bookService:amountCalculated", {
      isFree: serviceDetails.isFree,
      amount,
    });
    // Commission
    // =============================================
    // 🚫 BLOCK DOUBLE PAYMENT (Check pending payment)
    // =============================================
    const existingPayment = await Payment.findOne({
      user: userId,
      provider: providerId,
      service: serviceId,
      status: { $in: ["pending", "held"] },
    });
    logPaymentFlow("bookService:existingPaymentChecked", {
      existingPaymentId: existingPayment?._id,
      existingStatus: existingPayment?.status,
    });

    if (existingPayment) {
      logPaymentFlow("bookService:blockingDuplicatePayment", {
        paymentId: existingPayment._id,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "Payment already in progress. Please do not pay again.",
        paymentId: existingPayment._id,
      });
    }

    if (serviceDetails.isFree) {
      logPaymentFlow("bookService:freeServiceBranch", {
        userId,
        providerId,
        serviceId,
      });
      const booking = await Booking.create({
        customer: userId,
        provider: providerId,
        service: serviceId,
        amount: 0,
        status: "booked", // directly booked
        // ⭐ NEW FIELDS
        contactPhone: phone,
        location_name: location_name || null,
        ...(bookingLocation && { location: bookingLocation }),
      });
      logPaymentFlow("bookService:freeBookingCreated", {
        bookingId: booking._id,
      });
      // =====================================
      // REFERRAL BOOKING BONUS
      // =====================================

      if (customer.referredBy) {
        logPaymentFlow("bookService:referralDetected", {
          customerId: customer._id,
          referredBy: customer.referredBy,
        });
        const totalBookings = await Booking.countDocuments({
          customer: customer._id,

          status: {
            $in: ["booked", "started", "completed"],
          },
        });
        logPaymentFlow("bookService:referralTotalBookings", {
          customerId: customer._id,
          totalBookings,
        });

        // first booking only
        if (totalBookings === 1) {
          const referralOwner = await User.findById(customer.referredBy);
          logPaymentFlow("bookService:referralOwnerFetched", {
            referralOwnerId: referralOwner?._id,
          });

          if (referralOwner) {
            const wallet = await Wallet.findOne({
              user: referralOwner._id,
            });
            logPaymentFlow("bookService:referralWalletFetched", {
              referralOwnerId: referralOwner._id,
              walletFound: Boolean(wallet),
            });

            wallet.points += 50;

            wallet.totalEarned += 50;

            await wallet.save();

            await WalletHistory.create({
              user: referralOwner._id,

              points: 50,

              type: "referral_booking_bonus",

              referralUser: customer._id,

              service: serviceDetails._id,

              note: "First booking referral bonus",
            });

            referralOwner.totalReferralEarned += 50;

            referralOwner.totalReferralUsers += 1;

            await referralOwner.save();
            logPaymentFlow("bookService:referralBonusApplied", {
              referralOwnerId: referralOwner._id,
              referralUserId: customer._id,
              points: 50,
            });
          }
        }
      }
      // ⭐ Send Email
      console.log("📧 Calling sendServiceBookedEmail…");
      // Send customer email
      sendServiceBookedEmail(
        customer,
        serviceDetails,
        provider,
        booking,
        "customer",
      ).catch((err) => console.log("❌ Customer Email error:", err));

      // Send provider email
      sendServiceBookedEmail(
        customer,
        serviceDetails,
        provider,
        booking,
        "provider",
      ).catch((err) => console.log("❌ Provider Email error:", err));

      // ⭐ Send Notification
      console.log("🔔 Calling sendBookingNotification…");
      sendBookingNotification(
        customer,
        provider,
        serviceDetails,
        booking,
      ).catch((err) => console.log("❌ Notification error:", err));

      return res.status(200).json({
        isSuccess: true,
        message: "Free service booked successfully",
        bookingId: booking._id,
      });
    }

    if (!provider.stripeAccountId) {
      logPaymentFlow("bookService:providerStripeMissing", {
        providerId,
      });
      return res
        .status(400)
        .json({ message: "Provider stripe account missing" });
    }
    const commissionSetting = await CommissionSetting.findOne();

    const providerCommissionPercent =
      commissionSetting?.providerCommissionPercentage || 0;

    const customerCommissionPercent =
      commissionSetting?.customerCommissionPercentage || 0;

    const providerCommissionAmount = Number(
      ((amount * providerCommissionPercent) / 100).toFixed(2),
    );

    const customerCommissionAmount = Number(
      ((amount * customerCommissionPercent) / 100).toFixed(2),
    );

    const providerAmount = amount - providerCommissionAmount;
    logPaymentFlow("bookService:commissionCalculated", {
      providerCommissionPercent,
      customerCommissionPercent,
      providerCommissionAmount,
      customerCommissionAmount,
      providerAmount,
    });
    // =======================
    // WALLET REDEMPTION
    // =======================

    let wallet = null;

    let walletCoinsUsed = 0;

    let walletAmountUsed = 0;

    let customerPayable = amount + customerCommissionAmount;

    let platformContribution = 0;

    if (useWallet && !serviceDetails.isFree) {
      logPaymentFlow("bookService:walletBranchStart", { userId, amount });
      const config = await AdminWalletConfig.findOne();

      wallet = await Wallet.findOne({
        user: userId,
      });
      logPaymentFlow("bookService:walletDataFetched", {
        configFound: Boolean(config),
        walletFound: Boolean(wallet),
        walletPoints: wallet?.points || 0,
      });

      if (config && wallet && wallet.points > 0) {
        const redeemPercent = Number(config.maxWalletUsagePercent) || 0;

        const coinValue = Number(config.coinToCurrencyValue) || 1;
        logPaymentFlow("bookService:walletConfig", {
          redeemPercent,
          coinValue,
        });

        // ==========================
        // SERVICE AMOUNT % => COINS
        // Example:
        // 100 service
        // 20% => 20 coins
        // ==========================

        walletCoinsUsed = Math.floor((amount * redeemPercent) / 100);

        // safety
        const availableCoins = Math.max(
          0,
          wallet.points - (wallet.reservedPoints || 0),
        );
        walletCoinsUsed = Math.min(availableCoins, walletCoinsUsed);
        // convert coin to currency amount
        walletAmountUsed = walletCoinsUsed * coinValue;

        walletAmountUsed = Math.min(walletAmountUsed, amount);
        customerPayable = amount - walletAmountUsed + customerCommissionAmount;

        if (customerPayable < 0) {
          customerPayable = 0;
        }

        platformContribution = providerAmount - customerPayable;

        if (platformContribution < 0) {
          platformContribution = 0;
        }
        logPaymentFlow("bookService:walletCalculated", {
          walletCoinsUsed,
          walletAmountUsed,
          customerPayable,
          platformContribution,
        });
      } else {
        logPaymentFlow("bookService:walletSkippedNoConfigOrPoints", {
          configFound: Boolean(config),
          walletFound: Boolean(wallet),
          walletPoints: wallet?.points || 0,
        });
      }
    } else {
      logPaymentFlow("bookService:walletNotRequested", {
        useWallet,
        isFree: serviceDetails.isFree,
      });
    }
    // Stripe customer
    let customerStripeId = customer.stripeCustomerId;
    if (!customerStripeId) {
      logPaymentFlow("bookService:creatingStripeCustomer", {
        customerId: customer._id,
        email: customer.email,
      });
      const newCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
      });
      customerStripeId = newCustomer.id;
      customer.stripeCustomerId = customerStripeId;
      await customer.save();
      logPaymentFlow("bookService:stripeCustomerCreated", {
        customerId: customer._id,
        customerStripeId,
      });
    } else {
      logPaymentFlow("bookService:usingExistingStripeCustomer", {
        customerId: customer._id,
        customerStripeId,
      });
    }

    // Stripe Checkout
    logPaymentFlow("bookService:creatingCheckoutSession", {
      customerStripeId,
      currency,
      customerPayable,
      providerId,
      serviceId,
    });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerStripeId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: serviceDetails.title,
              description: serviceDetails.description || "No description",
            },
            unit_amount: Math.round(customerPayable * 100),
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        capture_method: "manual",

        metadata: {
          userId,
          providerId,
          serviceId,
        },
      },
      success_url: `https://yourflutterapp.com/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://yourflutterapp.com/payment-cancel`,
    });
    logPaymentFlow("bookService:checkoutSessionCreated", {
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
    });

    // Save only payment
    logPaymentFlow("bookService:creatingPaymentRecord", {
      checkoutSessionId: session.id,
      customerPayable,
      originalAmount: amount,
      walletCoinsUsed,
      walletAmountUsed,
      appCommission: providerCommissionAmount + customerCommissionAmount,
      providerAmount,
    });
    const payment = await Payment.create({
      user: userId,
      provider: providerId,
      service: serviceId,
      checkoutSessionId: session.id,
      customerStripeId,
      providerStripeId: provider.stripeAccountId,
      amount: customerPayable,
      currency,
      originalAmount: amount,

      walletCoinsUsed,

      walletAmountUsed,

      customerPaidAmount: customerPayable,

      platformContribution,

      usedWallet: walletCoinsUsed > 0,
      appCommission: providerCommissionAmount + customerCommissionAmount,

      providerCommissionPercentage: providerCommissionPercent,

      customerCommissionPercentage: customerCommissionPercent,

      providerCommissionAmount,

      customerCommissionAmount,

      totalPaidByCustomer: customerPayable,

      providerAmount,
      paymentIntentId: session.payment_intent,
      status: "pending",
      // ⭐ SAVE BOOKING DATA TEMPORARILY
      contactPhone: phone,
      location_name: location_name || null,
      ...(bookingLocation && { location: bookingLocation }),
    });

    if (walletCoinsUsed > 0) {
      wallet.reservedPoints = (wallet.reservedPoints || 0) + walletCoinsUsed;

      await wallet.save();
    }
    logPaymentFlow("bookService:paymentRecordCreated", {
      paymentId: payment._id,
      status: payment.status,
    });

    logPaymentFlow("bookService:successResponse", {
      paymentId: payment._id,
      sessionId: session.id,
    });
    res.json({
      isSuccess: true,
      redirectUrl: session.url,
      paymentId: payment._id,
    });
  } catch (err) {
    logPaymentError("bookService:error", err);
    res.status(500).json({ message: err.message });
  }
};

// -----------------------------
// 2️⃣ Confirm Payment & Create Booking
exports.updateBookingStatus = async (req, res) => {
  try {
    console.log("▶️ updateBookingStatus called");
    console.log("📥 Body:", req.body);
    logPaymentFlow("updateBookingStatus:start", { body: req.body });

    const { sessionId } = req.body;

    if (!sessionId) {
      console.log("❌ sessionId missing");
      logPaymentFlow("updateBookingStatus:missingSessionId");
      return res.status(400).json({ message: "sessionId is required" });
    }

    console.log("🔎 Fetching Stripe Session…");
    logPaymentFlow("updateBookingStatus:fetchingStripeSession", { sessionId });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log("🧾 Stripe Session Found:", session.id);
    logPaymentFlow("updateBookingStatus:stripeSessionFetched", {
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
      paymentStatus: session.payment_status,
    });

    console.log("🔎 Fetching PaymentIntent…");
    const paymentIntent = await stripe.paymentIntents.retrieve(
      session.payment_intent,
    );

    console.log("💳 PaymentIntent Status:", paymentIntent.status);
    logPaymentFlow("updateBookingStatus:paymentIntentFetched", {
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      metadata: paymentIntent.metadata,
    });

    if (paymentIntent.status !== "requires_capture") {
      console.log("❌ Payment NOT in requires_capture state.");
      logPaymentFlow("updateBookingStatus:paymentNotRequiresCapture", {
        status: paymentIntent.status,
      });
      return res.status(400).json({ message: "Payment not completed" });
    }

    // =============================================
    // 🚫 Fetch Payment From DB Before Using It
    // =============================================
    const payment = await Payment.findOne({ checkoutSessionId: sessionId });
    console.log("💰 Payment Found:", payment?._id);
    logPaymentFlow("updateBookingStatus:paymentFetchedFromDb", {
      paymentId: payment?._id,
      paymentStatus: payment?.status,
      bookingId: payment?.bookingId,
    });

    if (!payment) {
      console.log("❌ Payment not found in DB");
      logPaymentFlow("updateBookingStatus:paymentNotFound", { sessionId });
      return res.status(404).json({ message: "Payment not found" });
    }

    // =============================================
    // 🚫 PREVENT DOUBLE BOOKING
    // =============================================
    if (payment.status === "held" || payment.bookingId) {
      console.log("⚠️ Booking already exists:", payment.bookingId);
      logPaymentFlow("updateBookingStatus:bookingAlreadyCreated", {
        paymentId: payment._id,
        bookingId: payment.bookingId,
      });
      return res.json({
        isSuccess: true,
        message: "Booking already created earlier",
        bookingId: payment.bookingId,
      });
    }

    // =============================================
    // 📌 Metadata
    // =============================================
    const { userId, providerId, serviceId } = paymentIntent.metadata;
    console.log("🔐 Metadata:", session.metadata);
    logPaymentFlow("updateBookingStatus:metadataRead", {
      userId,
      providerId,
      serviceId,
      sessionMetadata: session.metadata,
      paymentIntentMetadata: paymentIntent.metadata,
    });

    console.log("🔎 Fetching Customer, Provider, Service…");
    logPaymentFlow("updateBookingStatus:fetchingRelatedData", {
      userId,
      providerId,
      serviceId,
    });

    const customer = await User.findById(userId);
    const provider = await User.findById(providerId);
    const service = await Service.findById(serviceId);

    console.log("👤 Customer:", customer ? "FOUND" : "NOT FOUND");
    console.log("🧑‍🔧 Provider:", provider ? "FOUND" : "NOT FOUND");
    console.log("🛠 Service:", service ? "FOUND" : "NOT FOUND");
    logPaymentFlow("updateBookingStatus:relatedDataFetched", {
      customerFound: Boolean(customer),
      providerFound: Boolean(provider),
      serviceFound: Boolean(service),
    });

    if (!customer || !provider || !service) {
      logPaymentFlow("updateBookingStatus:relatedDataMissing", {
        customerFound: Boolean(customer),
        providerFound: Boolean(provider),
        serviceFound: Boolean(service),
      });
      return res.status(404).json({
        message: "Service / Provider / Customer not found",
      });
    }

    // =============================================
    // 📝 Create Booking
    // =============================================
    console.log("📝 Creating booking…");
    logPaymentFlow("updateBookingStatus:creatingBooking", {
      userId,
      providerId,
      serviceId,
      paymentId: payment._id,
      amount: payment.originalAmount,
      currency: payment.currency,
    });
    const booking = await Booking.create({
      customer: userId,
      provider: providerId,
      service: serviceId,
      amount: payment.originalAmount,
      currency: payment.currency,
      paymentId: payment._id,
      status: "booked",
      // ⭐ COPY FROM PAYMENT
      contactPhone: payment.contactPhone,
      location_name: payment.location_name,
      ...(payment.location && { location: payment.location }),
    });

    console.log("✅ Booking Created:", booking._id);
    logPaymentFlow("updateBookingStatus:bookingCreated", {
      bookingId: booking._id,
    });

    // =============================================
    // 💾 Update Payment
    // =============================================
    payment.status = "held";
    payment.paymentIntentId = session.payment_intent;
    payment.bookingId = booking._id;
    await payment.save();

    console.log("💾 Payment updated");
    logPaymentFlow("updateBookingStatus:paymentUpdated", {
      paymentId: payment._id,
      status: payment.status,
      bookingId: payment.bookingId,
    });

    // =============================================
    // 📧 Send Emails
    // =============================================
    console.log("📧 Calling sendServiceBookedEmail…");

    sendServiceBookedEmail(
      customer,
      service,
      provider,
      booking,
      "customer",
    ).catch((err) => console.log("❌ Customer Email error:", err));

    sendServiceBookedEmail(
      customer,
      service,
      provider,
      booking,
      "provider",
    ).catch((err) => console.log("❌ Provider Email error:", err));

    // =============================================
    // 🔔 Send Notification
    // =============================================
    console.log("🔔 Calling sendBookingNotification…");
    logPaymentFlow("updateBookingStatus:sendingBookingNotification", {
      bookingId: booking._id,
    });

    sendBookingNotification(customer, provider, service, booking).catch((err) =>
      console.log("❌ Notification error:", err),
    );

    // =============================================
    // ✅ RESPONSE
    // =============================================
    logPaymentFlow("updateBookingStatus:successResponse", {
      bookingId: booking._id,
      paymentId: payment._id,
    });
    res.json({
      isSuccess: true,
      message: "Booking created after payment success",
      bookingId: booking._id,
    });
  } catch (err) {
    console.log("❌ updateBookingStatus ERROR:", err);
    logPaymentError("updateBookingStatus:error", err);
    res.status(500).json({ message: err.message });
  }
};

// ------------------------------
// 2) START SERVICE → GENERATE OTP → EMAIL
// ------------------------------
exports.startService = async (req, res) => {
  try {
    logPaymentFlow("startService:start", { body: req.body });
    const { bookingId } = req.body;
    logPaymentFlow("startService:fetchingBooking", { bookingId });
    const booking = await Booking.findById(bookingId)
      .populate("customer")
      .populate("provider")
      .populate("service");

    logPaymentFlow("startService:bookingFetched", {
      bookingId: booking?._id,
      status: booking?.status,
      customerFound: Boolean(booking?.customer),
      providerFound: Boolean(booking?.provider),
      serviceFound: Boolean(booking?.service),
    });

    if (!booking) {
      logPaymentFlow("startService:bookingNotFound", { bookingId });
      return res.status(404).json({ message: "Booking not found" });
    }

    const { customer, provider, service } = booking;
    if (!customer || !customer.email) {
      logPaymentFlow("startService:customerEmailMissing", {
        bookingId,
        customerId: customer?._id,
      });
      return res.status(400).json({ message: "Customer email missing" });
    }

    // Generate OTP
    logPaymentFlow("startService:generatingOtp", { bookingId });
    const { otp, expiry } = generateOTP();
    booking.otp = otp;
    booking.otpExpiry = expiry;
    await booking.save();
    logPaymentFlow("startService:otpSaved", {
      bookingId,
      otpExpiry: expiry,
    });

    // Send OTP email
    logPaymentFlow("startService:sendingOtpEmail", {
      bookingId,
      customerEmail: customer.email,
      providerId: provider?._id,
      serviceId: service?._id,
    });
    await sendServiceOtpEmail(customer.email, {
      customerName: customer.name,
      providerName: provider.name,
      serviceName: service.title,
      bookingId: booking._id,
      amount: booking.amount,
      otp,
    });
    logPaymentFlow("startService:otpEmailSent", { bookingId });

    logPaymentFlow("startService:successResponse", { bookingId });
    return res.json({
      isSuccess: true,
      message: "OTP generated & sent to customer email",
    }); // otp for testing
  } catch (err) {
    logPaymentError("startService:error", err);
    res.status(500).json({ message: err.message });
  }
};
//
// ------------------------------
// 3) VERIFY OTP
// ------------------------------
exports.verifyServiceOtp = async (req, res) => {
  try {
    logPaymentFlow("verifyServiceOtp:start", { body: req.body });
    const { bookingId, otp } = req.body;

    logPaymentFlow("verifyServiceOtp:fetchingBooking", { bookingId });
    const booking = await Booking.findById(bookingId)
      .populate("customer")
      .populate("provider")
      .populate("service");

    logPaymentFlow("verifyServiceOtp:bookingFetched", {
      bookingId: booking?._id,
      status: booking?.status,
      otpExpiry: booking?.otpExpiry,
    });

    if (!booking) {
      logPaymentFlow("verifyServiceOtp:bookingNotFound", { bookingId });
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.otpExpiry < new Date()) {
      logPaymentFlow("verifyServiceOtp:otpExpired", {
        bookingId,
        otpExpiry: booking.otpExpiry,
        now: new Date(),
      });
      return res.status(400).json({ message: "OTP expired" });
    }

    if (booking.otp != otp) {
      logPaymentFlow("verifyServiceOtp:invalidOtp", {
        bookingId,
        receivedOtp: otp,
      });
      return res.status(400).json({ message: "Invalid OTP" });
    }

    logPaymentFlow("verifyServiceOtp:otpValidUpdatingStatus", { bookingId });
    booking.status = "started";
    await booking.save();
    logPaymentFlow("verifyServiceOtp:statusUpdated", {
      bookingId,
      status: booking.status,
    });

    // 🎯 Only notify customer
    logPaymentFlow("verifyServiceOtp:sendingStartedNotification", {
      bookingId,
    });
    await sendServiceStartedNotification(
      booking.customer,
      booking.provider,
      booking.service,
      booking,
    );
    logPaymentFlow("verifyServiceOtp:startedNotificationSent", { bookingId });

    logPaymentFlow("verifyServiceOtp:successResponse", { bookingId });
    return res.json({
      isSuccess: true,
      message: "OTP verified & service started",
    });
  } catch (err) {
    logPaymentError("verifyServiceOtp:error", err);
    res.status(500).json({ message: err.message });
  }
};

// ------------------------------
// 4) COMPLETE SERVICE + CAPTURE PAYMENT
// ------------------------------
exports.completeService = async (req, res) => {
  try {
    logPaymentFlow("completeService:start", { body: req.body });
    const { bookingId } = req.body;

    logPaymentFlow("completeService:fetchingBooking", { bookingId });
    const booking = await Booking.findById(bookingId)
      .populate("service")
      .populate("customer")
      .populate("provider");

    logPaymentFlow("completeService:bookingFetched", {
      bookingId: booking?._id,
      status: booking?.status,
      amount: booking?.amount,
      paymentId: booking?.paymentId,
      serviceFound: Boolean(booking?.service),
      customerFound: Boolean(booking?.customer),
      providerFound: Boolean(booking?.provider),
    });

    if (!booking) {
      logPaymentFlow("completeService:bookingNotFound", { bookingId });
      return res.status(404).json({ message: "Booking not found" });
    }
    if (booking.status === "completed") {
      return res.json({
        isSuccess: true,
        message: "Service already completed",
      });
    }
    console.log("📌 Booking loaded:", booking);

    const customer = booking.customer;
    const provider = booking.provider;
    const service = booking.service;

    // Free service check first
    if (booking.amount === 0 || booking.service.isFree) {
      logPaymentFlow("completeService:freeServiceBranch", {
        bookingId,
        amount: booking.amount,
        isFree: booking.service.isFree,
      });
      booking.status = "completed";
      await booking.save();
      logPaymentFlow("completeService:freeBookingCompleted", {
        bookingId,
        status: booking.status,
      });
      // 🟢 Performance update → Completed service = +1
      console.log("📊 Updating provider performance (free service)...");
      logPaymentFlow("completeService:updatingFreeProviderPerformance", {
        providerId: provider._id,
      });
      await updateProviderPerformance(provider._id, 1, 0);
      logPaymentFlow("completeService:freeProviderPerformanceUpdated", {
        providerId: provider._id,
      });

      console.log("✅ Free service completed:", booking._id);
      // 1️⃣ Send Email (Customer Only)
      logPaymentFlow("completeService:sendingFreeCompletionEmail", {
        bookingId,
        customerId: customer?._id,
      });
      await sendServiceCompletedEmail(customer, provider, service, booking);
      logPaymentFlow("completeService:freeCompletionEmailSent", { bookingId });

      // ⬇ Send notification for free service
      logPaymentFlow("completeService:sendingFreeCompletionNotification", {
        bookingId,
      });
      await sendServiceCompletedNotification(
        customer,
        provider,
        service,
        booking,
      );
      logPaymentFlow("completeService:freeCompletionNotificationSent", {
        bookingId,
      });

      logPaymentFlow("completeService:freeSuccessResponse", { bookingId });
      return res.json({
        isSuccess: true,
        message: "Free service completed successfully",
      });
    }

    // OTP verification for paid services
    if (booking.status !== "started") {
      logPaymentFlow("completeService:paidServiceNotStarted", {
        bookingId,
        status: booking.status,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "Please start the service first by verifying OTP.",
      });
    }

    // Paid service → capture payment
    logPaymentFlow("completeService:fetchingPayment", {
      bookingId,
      paymentId: booking.paymentId,
    });
    const payment = await Payment.findById(booking.paymentId);
    logPaymentFlow("completeService:paymentFetched", {
      paymentId: payment?._id,
      status: payment?.status,
      paymentIntentId: payment?.paymentIntentId,
      providerAmount: payment?.providerAmount,
      usedWallet: payment?.usedWallet,
    });
    if (!payment) {
      logPaymentFlow("completeService:paymentNotFound", {
        bookingId,
        paymentId: booking.paymentId,
      });
      return res.status(404).json({ message: "Payment not found" });
    }
    if (payment.status === "completed") {
      return res.json({
        isSuccess: true,
        message: "Payment already completed",
      });
    }

    console.log("💰 Payment found:", payment._id);

    logPaymentFlow("completeService:capturingPaymentIntent", {
      paymentIntentId: payment.paymentIntentId,
    });

    const paymentIntent = await stripe.paymentIntents.retrieve(
      payment.paymentIntentId,
    );

    if (paymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.capture(payment.paymentIntentId);

      logPaymentFlow("completeService:paymentIntentCaptured", {
        paymentIntentId: payment.paymentIntentId,
      });
    } else {
      logPaymentFlow("completeService:paymentAlreadyCaptured", {
        paymentIntentId: payment.paymentIntentId,
        status: paymentIntent.status,
      });
    }
    // ========================
    // AUTO PROVIDER PAYOUT
    // ========================

    logPaymentFlow("completeService:creatingProviderTransfer", {
      amount: payment.providerAmount,
      currency: payment.currency,
      destination: provider.stripeAccountId,
      bookingId: booking._id,
    });
    let transferStatus = "pending";
    let transferId = null;

    try {
      const transfer = await stripe.transfers.create({
        amount: Math.round(payment.providerAmount * 100),
        currency: payment.currency,
        destination: provider.stripeAccountId,
        transfer_group: booking._id.toString(),
        metadata: {
          paymentId: payment._id.toString(),
          bookingId: booking._id.toString(),
          providerId: provider._id.toString(),
        },
      });

      transferStatus = "completed";
      transferId = transfer.id;

      logPaymentFlow("completeService:providerTransferCreated", {
        bookingId: booking._id,
        transferId: transfer.id,
      });
    } catch (transferError) {
      transferStatus = "failed";

      payment.transferFailureReason = transferError.message;

      payment.transferFailureCode = transferError.code || null;

      console.error("❌ Provider Transfer Failed", transferError);

      logPaymentError("providerTransfer:error", transferError);
    }

    // ========================
    // WALLET DEDUCTION
    // ========================

    if (payment.usedWallet && payment.walletCoinsUsed > 0) {
      logPaymentFlow("completeService:walletDeductionStart", {
        customerId: booking.customer._id,
        walletCoinsUsed: payment.walletCoinsUsed,
      });
      const wallet = await Wallet.findOne({
        user: booking.customer._id,
      });
      logPaymentFlow("completeService:walletFetched", {
        walletFound: Boolean(wallet),
        currentPoints: wallet?.points || 0,
      });

      if (wallet) {
        wallet.reservedPoints = Math.max(
          0,
          wallet.reservedPoints - payment.walletCoinsUsed,
        );

        wallet.points = Math.max(0, wallet.points - payment.walletCoinsUsed);
        wallet.totalSpent += payment.walletCoinsUsed;

        await wallet.save();
        logPaymentFlow("completeService:walletSaved", {
          walletId: wallet._id,
          points: wallet.points,
          totalSpent: wallet.totalSpent,
        });

        await WalletHistory.create({
          user: booking.customer._id,

          points: -payment.walletCoinsUsed,

          transactionType: "debit",

          type: "wallet_spent",

          service: booking.service._id,

          note: "Wallet used during booking",
        });
        logPaymentFlow("completeService:walletHistoryCreated", {
          customerId: booking.customer._id,
          points: -payment.walletCoinsUsed,
        });
      }
    } else {
      logPaymentFlow("completeService:walletDeductionSkipped", {
        usedWallet: payment.usedWallet,
        walletCoinsUsed: payment.walletCoinsUsed,
      });
    }

    logPaymentFlow("completeService:updatingBookingAndPayment", {
      bookingId,
      paymentId: payment._id,
    });
    booking.status = "completed";
    await booking.save();

    payment.status = "completed";
    payment.completedAt = new Date();

    payment.transferStatus = transferStatus;
    payment.transferId = transferId;
    payment.transferAmount = payment.providerAmount;

    payment.transferDestination = provider.stripeAccountId;
    await payment.save();
    // =====================================
    // AMBASSADOR COMMISSION
    // =====================================

    try {
      await processAmbassadorCommission({
        booking,
        payment,
        customer,
        provider,
        service,
      });

      console.log("✅ Ambassador commission processed");
    } catch (commissionError) {
      console.error("❌ Ambassador commission failed", commissionError);

      // Optional log
      logPaymentError("ambassadorCommission:error", commissionError);
    }
    logPaymentFlow("completeService:bookingAndPaymentUpdated", {
      bookingStatus: booking.status,
      paymentStatus: payment.status,
      completedAt: payment.completedAt,
    });
    console.log("✅ Paid service completed & payment captured:", booking._id);
    // 🟢 Performance update → Paid service completed = +1
    console.log("📊 Updating provider performance (paid service)...");
    logPaymentFlow("completeService:updatingPaidProviderPerformance", {
      providerId: provider._id,
    });
    await updateProviderPerformance(provider._id, 1, 0);
    logPaymentFlow("completeService:paidProviderPerformanceUpdated", {
      providerId: provider._id,
    });

    // ⬇ Send Email (only to customer)
    logPaymentFlow("completeService:sendingPaidCompletionEmail", {
      bookingId,
      customerId: customer?._id,
    });
    await sendServiceCompletedEmail(customer, provider, service, booking);
    logPaymentFlow("completeService:paidCompletionEmailSent", { bookingId });

    // ⬇ Send Notification (customer + provider)
    logPaymentFlow("completeService:sendingPaidCompletionNotification", {
      bookingId,
    });
    await sendServiceCompletedNotification(
      customer,
      provider,
      service,
      booking,
    );
    logPaymentFlow("completeService:paidCompletionNotificationSent", {
      bookingId,
    });

    logPaymentFlow("completeService:paidSuccessResponse", { bookingId });
    return res.json({
      isSuccess: true,
      message: "Service completed & payment captured",
    });
  } catch (err) {
    console.log("❌ completeService ERROR:", err);
    logPaymentError("completeService:error", err);
    res.status(500).json({ message: err.message });
  }
};

// GET USER BOOKINGS (Customer & Provider)
exports.getUserBookings = async (req, res) => {
  try {
    logPaymentFlow("getUserBookings:start", { body: req.body });
    const { userId } = req.body; // ⭐ Body se userId

    if (!userId) {
      logPaymentFlow("getUserBookings:missingUserId");
      return res.status(400).json({ message: "userId is required" });
    }

    // Customer bookings
    logPaymentFlow("getUserBookings:fetchingCustomerBookings", { userId });
    const customerBookings = await Booking.find({ customer: userId })
      .populate({
        path: "service",
        populate: {
          path: "category",
          select: "categoryId name",
        },
      })
      .populate("provider", "name email profile_image")
      .sort({ createdAt: -1 });
    logPaymentFlow("getUserBookings:customerBookingsFetched", {
      userId,
      count: customerBookings.length,
    });
    // Provider bookings
    logPaymentFlow("getUserBookings:fetchingProviderBookings", { userId });
    const providerBookings = await Booking.find({ provider: userId })
      .populate({
        path: "service",
        populate: {
          path: "category",
          select: "categoryId name",
        },
      })
      .populate("customer", "name email profile_image")
      .sort({ createdAt: -1 });
    logPaymentFlow("getUserBookings:providerBookingsFetched", {
      userId,
      count: providerBookings.length,
    });

    const bookings = [];
    logPaymentFlow("getUserBookings:buildingResponseList", {
      customerCount: customerBookings.length,
      providerCount: providerBookings.length,
    });

    customerBookings.forEach((b) => {
      bookings.push({
        bookingId: b._id,
        role: "customer",
        service: b.service,
        otherUser: b.provider,
        // ✅ ADD THESE
        contactPhone: b.contactPhone,
        location_name: b.location_name,
        location: b.location,
        // 🔴 ADD THESE
        cancelledBy: b.cancelledBy,
        cancelReason: b.cancelReason,
        refundAmount: b.refundAmount,
        cancellationFee: b.cancellationFee,

        status: b.status,
        amount: b.amount,
        createdAt: b.createdAt,
      });
    });

    providerBookings.forEach((b) => {
      bookings.push({
        bookingId: b._id,
        role: "provider",
        service: b.service,
        otherUser: b.customer,
        // ✅ ADD THESE
        contactPhone: b.contactPhone,
        location_name: b.location_name,
        location: b.location,
        // 🔴 ADD THESE
        cancelledBy: b.cancelledBy,
        cancelReason: b.cancelReason,
        refundAmount: b.refundAmount,
        cancellationFee: b.cancellationFee,
        status: b.status,
        amount: b.amount,
        createdAt: b.createdAt,
      });
    });

    bookings.sort((a, b) => b.createdAt - a.createdAt);
    logPaymentFlow("getUserBookings:successResponse", {
      userId,
      totalCount: bookings.length,
    });

    return res.json({ isSuccess: true, bookings });
  } catch (err) {
    logPaymentError("getUserBookings:error", err);
    return res.status(500).json({ message: err.message });
  }
};

// ------------------------------
// CANCEL BOOKING + PARTIAL REFUND
// ------------------------------
// ------------------------------
// CANCEL BOOKING + PARTIAL REFUND (ALWAYS REFUND EVEN IF NOT CAPTURED)
// ------------------------------
exports.refundBooking = async (req, res) => {
  console.log("🚀 [API] refundBooking Called");
  console.log("📥 Request Body:", req.body);
  logPaymentFlow("refundBooking:start", { body: req.body });

  try {
    const { bookingId, cancelledBy, reason } = req.body;
    logPaymentFlow("refundBooking:requestParsed", {
      bookingId,
      cancelledBy,
      hasReason: Boolean(reason),
    });

    // ---------------------------------------------------------
    // 1️⃣ FETCH BOOKING
    // ---------------------------------------------------------
    console.log("🔍 Fetching Booking…");
    logPaymentFlow("refundBooking:fetchingBooking", { bookingId });
    const booking = await Booking.findById(bookingId)
      .populate("customer")
      .populate("provider")
      .populate("service");

    console.log("📦 Booking Found:", booking?._id);
    logPaymentFlow("refundBooking:bookingFetched", {
      bookingId: booking?._id,
      status: booking?.status,
      amount: booking?.amount,
      paymentId: booking?.paymentId,
      customerFound: Boolean(booking?.customer),
      providerFound: Boolean(booking?.provider),
      serviceFound: Boolean(booking?.service),
    });

    if (!booking) {
      console.log("❌ Booking Not Found");
      logPaymentFlow("refundBooking:bookingNotFound", { bookingId });
      return res.status(404).json({ message: "Booking not found" });
    }

    console.log("📌 Booking Status:", booking.status);

    if (booking.status === "completed") {
      logPaymentFlow("refundBooking:blockedCompletedBooking", {
        bookingId,
        status: booking.status,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "Service already completed. Cancellation not allowed.",
      });
    }

    if (booking.status === "started") {
      logPaymentFlow("refundBooking:blockedStartedBooking", {
        bookingId,
        status: booking.status,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "Service already started. Cancellation not allowed.",
      });
    }

    if (booking.status !== "booked") {
      logPaymentFlow("refundBooking:blockedNonBookedStatus", {
        bookingId,
        status: booking.status,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "Only booked services can be cancelled.",
      });
    }

    // ==========================================================
    // ⭐ FREE SERVICE CANCELLATION
    // ==========================================================
    if (booking.amount === 0) {
      console.log("❗ Free service cancellation detected");
      logPaymentFlow("refundBooking:freeCancellationBranch", {
        bookingId,
        cancelledBy,
      });

      booking.status = "cancelled";
      booking.cancelledBy = cancelledBy || "customer";
      booking.cancelReason = reason || null;

      // ✅ Free service = no money
      booking.cancellationFee = 0;
      booking.refundAmount = 0;

      await booking.save();
      logPaymentFlow("refundBooking:freeBookingUpdated", {
        bookingId,
        status: booking.status,
        cancelledBy: booking.cancelledBy,
      });
      // ⭐ PERFORMANCE: Provider cancelled free service → 1 failed
      if (cancelledBy === "provider") {
        console.log("📉 Updating provider performance (free cancel)…");
        logPaymentFlow("refundBooking:updatingFreeCancelPerformance", {
          providerId: booking.provider._id,
        });
        await updateProviderPerformance(booking.provider._id, 0, 1);
        logPaymentFlow("refundBooking:freeCancelPerformanceUpdated", {
          providerId: booking.provider._id,
        });
      }
      console.log("📧 Sending cancel email for FREE service...");
      console.log("📧 Sending Cancel Email…");
      console.log("📧 Customer Email:", booking.customer?.email);
      console.log("📧 Provider Email:", booking.provider?.email);
      console.log("📧 Service Title:", booking.service?.title);
      console.log("📧 Booking ID:", booking._id);
      console.log("📧 Cancel Reason:", reason);
      try {
        const emailResponse = await sendServiceCancelledEmail(
          booking.customer,
          booking.provider,
          booking.service,
          booking,
          reason,
        );

        console.log("✅ [EMAIL] Email function executed");
        console.log("📧 Email Response:", emailResponse);
        logPaymentFlow("refundBooking:freeCancelEmailSent", { bookingId });
      } catch (emailErr) {
        console.error("❌ [EMAIL ERROR] Failed to send cancel email");
        console.error(emailErr);
        logPaymentError("refundBooking:freeCancelEmailError", emailErr);
      }

      // 🔔 SEND NOTIFICATION
      console.log("🔔 Sending cancel notification for FREE service...");
      try {
        await sendServiceCancelledNotification(
          booking.customer,
          booking.provider,
          booking.service,
          booking,
          reason || "",
        );
        console.log("✅ Free service cancel notification sent");
        logPaymentFlow("refundBooking:freeCancelNotificationSent", {
          bookingId,
        });
      } catch (err) {
        console.error("❌ Free service notification failed", err);
        logPaymentError("refundBooking:freeCancelNotificationError", err);
      }
      logPaymentFlow("refundBooking:freeSuccessResponse", {
        bookingId,
        cancelledBy: booking.cancelledBy,
      });
      return res.json({
        isSuccess: true,
        message: "Free service cancelled successfully",
        cancelledBy: booking.cancelledBy,
        reason: booking.cancelReason,
      });
    }

    // ---------------------------------------------------------
    // 2️⃣ FETCH PAYMENT
    // ---------------------------------------------------------
    console.log("💳 Fetching Payment…");
    logPaymentFlow("refundBooking:fetchingPayment", {
      paymentId: booking.paymentId,
      bookingId,
    });
    let payment = await Payment.findById(booking.paymentId);
    if (!payment) payment = await Payment.findOne({ bookingId });

    console.log("💳 Payment Found:", payment?._id);
    logPaymentFlow("refundBooking:paymentFetched", {
      paymentId: payment?._id,
      status: payment?.status,
      paymentIntentId: payment?.paymentIntentId,
      amount: payment?.amount,
    });

    if (!payment) {
      console.log("❌ Payment Not Found");
      logPaymentFlow("refundBooking:paymentNotFound", { bookingId });
      return res.status(404).json({ message: "Payment not found" });
    }

    console.log("➡ Retrieving PaymentIntent…");
    logPaymentFlow("refundBooking:fetchingPaymentIntent", {
      paymentIntentId: payment.paymentIntentId,
    });

    const paymentIntent = await stripe.paymentIntents.retrieve(
      payment.paymentIntentId,
    );

    console.log("✔ PaymentIntent Status:", paymentIntent.status);
    logPaymentFlow("refundBooking:paymentIntentFetched", {
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
    });

    // ---------------------------------------------------------
    // 3️⃣ CANCELLATION FEE LOGIC
    // ---------------------------------------------------------
    console.log("⚙️ Calculating Cancellation Fee…");

    let cancellationPercent = 0;

    if (cancelledBy === "provider") {
      console.log("👨‍🔧 Provider canceled → Full Refund (0% fee)");
      cancellationPercent = 0;
    } else {
      const setting = await CancellationSetting.findOne();
      cancellationPercent = setting?.enabled ? setting.percentage : 0;
      console.log("📊 Cancellation %:", cancellationPercent);
      logPaymentFlow("refundBooking:cancellationSettingFetched", {
        settingFound: Boolean(setting),
        enabled: setting?.enabled,
        cancellationPercent,
      });
    }

    let discountedServiceAmount =
      payment.originalAmount - (payment.walletAmountUsed || 0);

    let cancellationFee = 0;
    let refundAmount = 0;
    let platformRetainedAmount = 0;

    if (cancelledBy === "provider") {
      // Provider ki galti
      refundAmount = payment.customerPaidAmount;

      cancellationFee = 0;

      platformRetainedAmount = 0;
    } else {
      cancellationFee = Number(
        ((discountedServiceAmount * cancellationPercent) / 100).toFixed(2),
      );

      refundAmount = Number(
        (discountedServiceAmount - cancellationFee).toFixed(2),
      );

      platformRetainedAmount = Number(
        (cancellationFee + (payment.customerCommissionAmount || 0)).toFixed(2),
      );
    }
    console.log("========== REFUND DEBUG ==========");
    console.log("payment.originalAmount:", payment.originalAmount);
    console.log("payment.walletAmountUsed:", payment.walletAmountUsed);
    console.log("payment.customerPaidAmount:", payment.customerPaidAmount);
    console.log(
      "payment.customerCommissionAmount:",
      payment.customerCommissionAmount,
    );
    console.log("discountedServiceAmount:", discountedServiceAmount);
    console.log("cancellationPercent:", cancellationPercent);
    console.log("cancellationFee:", cancellationFee);
    console.log("refundAmount:", refundAmount);
    console.log("==================================");
    console.log(
      "💰 Total Amount:",
      cancelledBy === "provider"
        ? payment.customerPaidAmount
        : discountedServiceAmount,
    );
    console.log("💰 Cancellation Fee:", cancellationFee);
    console.log("💰 Refundable Amount:", refundAmount);
    logPaymentFlow("refundBooking:refundAmountsCalculated", {
      totalAmount:
        cancelledBy === "provider"
          ? payment.customerPaidAmount
          : discountedServiceAmount,

      cancellationPercent,

      cancellationFee,

      refundAmount,

      platformRetainedAmount,
    });

    // ---------------------------------------------------------
    // 4️⃣ HANDLE CAPTURE CASE
    // ---------------------------------------------------------
    if (paymentIntent.status === "requires_capture") {
      console.log("⚠️ Payment requires capture → capturing now…");
      logPaymentFlow("refundBooking:capturingBeforeRefund", {
        paymentIntentId: payment.paymentIntentId,
      });
      await stripe.paymentIntents.capture(payment.paymentIntentId);
      console.log("✔ Payment Captured Successfully");
      logPaymentFlow("refundBooking:captureBeforeRefundSuccess", {
        paymentIntentId: payment.paymentIntentId,
      });
    }

    // ---------------------------------------------------------
    // 5️⃣ STRIPE REFUND
    // ---------------------------------------------------------
    console.log("🔁 Creating Refund…");
    logPaymentFlow("refundBooking:creatingStripeRefund", {
      paymentIntentId: payment.paymentIntentId,
      refundAmount,
    });
    const stripeRefundReason = "requested_by_customer";
    const refund = await stripe.refunds.create({
      payment_intent: payment.paymentIntentId,
      amount: Math.round(refundAmount * 100),
      reason: stripeRefundReason,

      metadata: {
        bookingId: booking._id.toString(),
        paymentId: payment._id.toString(),
        customerId: booking.customer._id.toString(),
        providerId: booking.provider._id.toString(),
        serviceId: booking.service._id.toString(),
        cancelledBy,
        cancellationReason: reason || "",
      },
    });
    console.log("🔁 Stripe Refund ID:", refund.id);
    if (refund.status !== "succeeded") {
      console.error("Refund not completed immediately");

      console.error({
        status: refund.status,
        failureReason: refund.failure_reason,
        failureBalanceTransaction: refund.failure_balance_transaction,
      });

      logPaymentFlow("refundBooking:refundPending", {
        refundId: refund.id,
        status: refund.status,
        failureReason: refund.failure_reason,
      });
    }

    // ---------------------------------------------------------
    // 6️⃣ UPDATE DB — BOOKING + PAYMENT
    // ---------------------------------------------------------
    console.log("💾 Updating Booking & Payment…");

    // ✅ UPDATE BOOKING (PAID SERVICE)
    booking.status = "cancelled";
    booking.cancelledBy = cancelledBy || "customer";
    booking.cancelReason = reason || null;

    // 🔥 REAL VALUES SAVE KARO
    booking.cancellationFee = cancellationFee;
    booking.refundAmount = refundAmount;

    await booking.save();
    console.log("✔ Booking Updated");
    logPaymentFlow("refundBooking:bookingUpdated", {
      bookingId,
      status: booking.status,
      cancellationFee: booking.cancellationFee,
      refundAmount: booking.refundAmount,
    });
    if (payment.usedWallet && payment.walletCoinsUsed > 0) {
      const wallet = await Wallet.findOne({
        user: booking.customer._id,
      });

      if (wallet) {
        wallet.reservedPoints = Math.max(
          0,
          wallet.reservedPoints - payment.walletCoinsUsed,
        );

        await wallet.save();

        await WalletHistory.create({
          user: booking.customer._id,
          points: payment.walletCoinsUsed,
          transactionType: "credit",
          type: "wallet_refund",
          service: booking.service._id,
          note: "Wallet coins released after cancellation",
        });
      }
    }
    // ✅ UPDATE PAYMENT
    payment.status = refund.status === "succeeded" ? "refunded" : "pending";

    payment.refundId = refund.id;

    payment.refundStatus = refund.status;

    payment.refundReason =
      cancelledBy === "provider"
        ? "Provider cancelled booking"
        : reason || "Customer cancelled booking";
    payment.refundedAmount = refundAmount;

    payment.cancellationFee = cancellationFee;

    payment.platformRetainedAmount = platformRetainedAmount;

    payment.refundedAt = new Date();
    await payment.save();
    console.log("✔ Payment Updated");
    logPaymentFlow("refundBooking:paymentUpdated", {
      paymentId: payment._id,
      status: payment.status,
      refundedAmount: payment.refundedAmount,
      cancellationFee: payment.cancellationFee,
    });

    // ---------------------------------------------------------
    // ⭐ 7️⃣ PERFORMANCE UPDATE (Provider Cancel → BAD)
    // ---------------------------------------------------------
    if (cancelledBy === "provider") {
      console.log("❗ Provider canceled → Performance DOWN");

      // failedCount = 1
      logPaymentFlow("refundBooking:updatingProviderCancelPerformance", {
        providerId: booking.provider._id,
      });
      await updateProviderPerformance(booking.provider._id, 0, 1);

      console.log("📉 Provider performance updated after cancellation");
      logPaymentFlow("refundBooking:providerCancelPerformanceUpdated", {
        providerId: booking.provider._id,
      });
    }

    // ---------------------------------------------------------
    // 8️⃣ SEND EMAIL
    // ---------------------------------------------------------
    console.log("📧 Sending Cancel Email…");
    console.log("📧 Customer Email:", booking.customer?.email);
    console.log("📧 Provider Email:", booking.provider?.email);
    console.log("📧 Service Title:", booking.service?.title);
    console.log("📧 Booking ID:", booking._id);
    console.log("📧 Cancel Reason:", reason);
    try {
      const emailResponse = await sendServiceCancelledEmail(
        booking.customer,
        booking.provider,
        booking.service,
        booking,
        reason,
      );

      console.log("✅ [EMAIL] Email function executed");
      console.log("📧 Email Response:", emailResponse);
      logPaymentFlow("refundBooking:paidCancelEmailSent", { bookingId });
    } catch (emailErr) {
      console.error("❌ [EMAIL ERROR] Failed to send cancel email");
      console.error(emailErr);
      logPaymentError("refundBooking:paidCancelEmailError", emailErr);
    }

    // ---------------------------------------------------------
    // 9️⃣ SEND NOTIFICATIONS
    // ---------------------------------------------------------
    console.log("🔔 Sending Cancel Notifications…");

    await sendServiceCancelledNotification(
      booking.customer,
      booking.provider,
      booking.service,
      booking,
      reason,
    );

    console.log("🎉 refundBooking Completed Successfully");
    logPaymentFlow("refundBooking:successResponse", {
      bookingId,
      refundAmount,
      cancellationFee,
      refundId: refund.id,
    });

    return res.json({
      isSuccess: true,
      message: "Booking cancelled & refund processed.",
      refundAmount,
      cancellationFee,
      refundId: refund.id,
      cancelledBy: booking.cancelledBy,
      reason: booking.cancelReason,
    });
  } catch (err) {
    console.error("❌ refundBooking Error:", err.message);
    logPaymentError("refundBooking:error", err);
    return res.status(500).json({ message: err.message });
  }
};
//new code add
exports.bookingPreview = async (req, res) => {
  try {
    logPaymentFlow("bookingPreview:start", { body: req.body });
    const { userId, serviceId, useWallet = false } = req.body;

    logPaymentFlow("bookingPreview:fetchingService", { serviceId });
    const service = await Service.findById(serviceId);
    logPaymentFlow("bookingPreview:serviceFetched", {
      serviceFound: Boolean(service),
      serviceId: service?._id,
      price: service?.price,
      currency: service?.currency,
    });

    if (!service) {
      logPaymentFlow("bookingPreview:serviceNotFound", { serviceId });
      return res.status(404).json({
        isSuccess: false,
        message: "Service not found",
      });
    }

    logPaymentFlow("bookingPreview:fetchingWallet", { userId });
    const wallet = await Wallet.findOne({
      user: userId,
    });
    logPaymentFlow("bookingPreview:walletFetched", {
      walletFound: Boolean(wallet),
      walletBalance: wallet?.points || 0,
    });

    logPaymentFlow("bookingPreview:fetchingWalletConfig");
    const config = await AdminWalletConfig.findOne();
    logPaymentFlow("bookingPreview:walletConfigFetched", {
      configFound: Boolean(config),
      coinToCurrencyValue: config?.coinToCurrencyValue,
      maxWalletUsagePercent: config?.maxWalletUsagePercent,
      currency: config?.currency,
    });

    const amount = Number(service.price || 0);
    const commissionSetting = await CommissionSetting.findOne();

    const providerCommissionPercent =
      commissionSetting?.providerCommissionPercentage || 0;

    const customerCommissionPercent =
      commissionSetting?.customerCommissionPercentage || 0;

    const customerCommissionAmount = (amount * customerCommissionPercent) / 100;
    const coinValue = Number(config?.coinToCurrencyValue) || 1;

    const redeemPercent = Number(config?.maxWalletUsagePercent) || 0;

    const maxRedeemableCoins = Math.floor((amount * redeemPercent) / 100);

    const walletBalance = wallet?.points || 0;

    const reservedCoins = wallet?.reservedPoints || 0;

    const availableCoins = Math.max(0, walletBalance - reservedCoins);

    let coinsUsed = 0;

    let walletDiscount = 0;

    let finalPayable = amount + customerCommissionAmount;
    logPaymentFlow("bookingPreview:baseValuesCalculated", {
      amount,
      coinValue,
      redeemPercent,
      maxRedeemableCoins,
      walletBalance,
      useWallet,
    });

    if (useWallet) {
      logPaymentFlow("bookingPreview:walletCalculationStart", {
        walletBalance,
        maxRedeemableCoins,
        amount,
      });
      coinsUsed = Math.min(availableCoins, maxRedeemableCoins);

      walletDiscount = coinsUsed * coinValue;

      walletDiscount = Math.min(walletDiscount, amount);

      finalPayable = amount - walletDiscount + customerCommissionAmount;
      logPaymentFlow("bookingPreview:walletCalculationDone", {
        coinsUsed,
        walletDiscount,
        finalPayable,
      });
    } else {
      logPaymentFlow("bookingPreview:walletNotUsed", {
        finalPayable,
      });
    }
    const remainingCoins = Math.max(0, availableCoins - coinsUsed);
    const isOwnService = String(service.user) === String(userId);

    const canRedeem =
      availableCoins > 0 && maxRedeemableCoins > 0 && !isOwnService;
    const walletEligibleCoins = Math.min(availableCoins, maxRedeemableCoins);
    const eligibleDiscountPercent =
      amount > 0 ? Number(((walletDiscount / amount) * 100).toFixed(2)) : 0;

    logPaymentFlow("bookingPreview:successResponse", {
      serviceAmount: amount,
      walletBalance,
      maxRedeemableCoins,
      coinsUsed,
      walletDiscount,
      finalPayable,
      useWallet,
    });

    return res.json({
      isSuccess: true,

      serviceAmount: amount,

      currency: config?.currency || service.currency || "EUR",

      walletBalance,

      reservedCoins,

      availableCoins,

      remainingCoins,

      coinValue,

      redeemPercent,

      maxRedeemableCoins,

      coinsUsed,

      walletDiscount,

      eligibleDiscountPercent,

      finalPayable,

      canRedeem,

      isOwnService,
      providerCommissionPercent,
      customerCommissionPercent,
      customerCommissionAmount,

      useWallet,
      walletEligibleCoins,
    });
  } catch (err) {
    logPaymentError("bookingPreview:error", err);
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
exports.stripeWebhook = async (req, res) => {
  let event;

  try {
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(req.body, signature, endpointSecret);

    console.log("✅ Stripe Event :", event.type);
  } catch (err) {
    console.log("❌ Webhook Verify Failed", err.message);

    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        console.log("Checkout Completed :", session.id);

        const payment = await Payment.findOne({
          checkoutSessionId: session.id,
        });

        console.log("🧾 Webhook payment lookup:", {
          checkoutSessionId: session.id,
          paymentId: payment?._id,
          paymentStatus: payment?.status,
          bookingId: payment?.bookingId,
        });

        if (!payment) {
          console.log("Payment not found");
          break;
        }

        if (payment.status === "held" || payment.bookingId) {
          console.log("Already processed");
          break;
        }
        const alreadyBooking = await Booking.findOne({
          paymentId: payment._id,
        });

        if (alreadyBooking) {
          console.log("Booking already exists");
          break;
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(
          session.payment_intent,
        );
        if (paymentIntent.status !== "requires_capture") {
          console.log("Payment not authorized");
          break;
        }

        const { userId, providerId, serviceId } = paymentIntent.metadata;
        const customer = await User.findById(userId);
        const provider = await User.findById(providerId);
        const service = await Service.findById(serviceId);

        if (!customer || !provider || !service) {
          console.log("Invalid customer/provider/service");
          break;
        }

        const booking = await Booking.create({
          customer: userId,
          provider: providerId,
          service: serviceId,

          amount: payment.originalAmount,
          currency: payment.currency,

          paymentId: payment._id,

          status: "booked",

          contactPhone: payment.contactPhone,

          location_name: payment.location_name,

          ...(payment.location && {
            location: payment.location,
          }),
        });

        payment.status = "held";
        payment.bookingId = booking._id;
        payment.paymentIntentId = paymentIntent.id;
        payment.customerStripeId = paymentIntent.customer;
        payment.heldAt = new Date();
        await payment.save();

        try {
          await sendServiceBookedEmail(
            customer,
            service,
            provider,
            booking,
            "customer",
          );
        } catch (err) {
          console.log("Error sending email to customer:", err);
        }
        try {
          await sendServiceBookedEmail(
            customer,
            service,
            provider,
            booking,
            "provider",
          );
        } catch (err) {
          console.log("Error sending email to provider:", err);
        }

        try {
          await sendBookingNotification(customer, provider, service, booking);
        } catch (err) {
          console.log("Error sending notification:", err);
        }

        console.log("Booking Created");
        break;
      }

      case "charge.refunded": {
        console.log("Refund Success");

        const charge = event.data.object;

        const payment = await Payment.findOne({
          paymentIntentId: charge.payment_intent,
        });

        if (payment) {
          payment.status = "refunded";
          payment.refundId = charge.refunds?.data?.[0]?.id || null;

          payment.refundStatus =
            charge.refunds?.data?.[0]?.status || "succeeded";
          payment.refundedAt = new Date();
          payment.refundedAmount = (charge.amount_refunded || 0) / 100;
          payment.refundReason = charge.refunds?.data?.[0]?.reason || null;
          await payment.save();

          console.log("Payment Updated");
        }

        break;
      }
      case "payment_intent.payment_failed": {
        console.log("Payment Failed");

        const paymentIntent = event.data.object;

        const payment = await Payment.findOne({
          paymentIntentId: paymentIntent.id,
        });

        if (payment) {
          payment.status = "failed";
          payment.failureReason =
            paymentIntent.last_payment_error?.message || null;
          await payment.save();

          console.log("Payment marked as failed");
        }

        break;
      }
      case "charge.captured": {
        console.log("Charge Captured");

        const charge = event.data.object;

        const payment = await Payment.findOne({
          paymentIntentId: charge.payment_intent,
        });

        if (payment) {
          payment.captureStatus = "captured";
          payment.capturedAt = new Date();

          await payment.save();

          console.log("Capture updated");
        }

        break;
      }
      case "transfer.created": {
        console.log("Transfer Created");

        const transfer = event.data.object;

        const payment = await Payment.findOne({
          transferId: transfer.id,
        });

        if (payment) {
          payment.transferStatus = "completed";
          payment.transferAmount = transfer.amount / 100;

          payment.transferDestination = transfer.destination;

          payment.transferCreatedAt = new Date(transfer.created * 1000);

          await payment.save();

          console.log("Transfer saved");
        }

        break;
      }
      case "transfer.updated": {
        console.log("Transfer Updated");

        const transfer = event.data.object;

        const payment = await Payment.findOne({
          transferId: transfer.id,
        });

        if (payment) {
          payment.transferStatus = transfer.reversed ? "reversed" : "completed";
          payment.transferAmount = transfer.amount / 100;

          payment.transferDestination = transfer.destination;
          await payment.save();

          console.log("Transfer updated");
        }

        break;
      }
      case "transfer.reversed": {
        console.log("Transfer Reversed");

        const reversal = event.data.object;

        const payment = await Payment.findOne({
          transferId: reversal.transfer,
        });

        if (payment) {
          payment.transferStatus = "reversed";
          payment.transferFailureReason =
            reversal.metadata?.reason || "Transfer reversed";
          payment.transferFailureCode = reversal.failure_code || null;
          await payment.save();

          console.log("Transfer reversal updated");
        }

        break;
      }
      // ======================================
      // AMBASSADOR PAYOUT WEBHOOKS
      // ======================================

      case "payout.created":
        await ambassadorController.handlePayoutCreated(event.data.object);
        break;

      case "payout.updated":
        await ambassadorController.handlePayoutUpdated(event.data.object);
        break;

      case "payout.paid":
        await ambassadorController.handlePayoutPaid(event.data.object);
        break;

      case "payout.failed":
        await ambassadorController.handlePayoutFailed(event.data.object);
        break;
      default:
        console.log("Unhandled Event :", event.type);
    }

    return res.json({ received: true });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      message: err.message,
    });
  }
};
