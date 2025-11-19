const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const {
  sendServiceOtpEmail,
  sendServiceBookedEmail,
} = require("../utils/email");
const { generateOTP } = require("../utils/otp");
const {
  sendBookingNotification,
  sendServiceStartedNotification,
} = require("../controller/notificationController"); // ✅ import it

const User = require("../model/User");
const Service = require("../model/Service");
const Payment = require("../model/Payment");
const Booking = require("../model/Booking");
const CommissionSetting = require("../model/CommissionSetting");

// Email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

// -----------------------------
// 1️⃣ Create Stripe Checkout Session (Booking not yet confirmed)
// -----------------------------
exports.bookService = async (req, res) => {
  try {
    const { userId, providerId, serviceId, amount } = req.body;

    // Commission
    const commissionSetting = await CommissionSetting.findOne();
    const commissionPercent = commissionSetting?.percentage || 20;
    const commission = Math.round((amount * commissionPercent) / 100);
    const providerAmount = amount - commission;

    // Data
    const customer = await User.findById(userId);
    const provider = await User.findById(providerId);
    const serviceDetails = await Service.findById(serviceId);

    if (!customer || !provider || !serviceDetails)
      return res.status(404).json({ message: "Data not found" });

    if (!provider.stripeAccountId)
      return res
        .status(400)
        .json({ message: "Provider stripe account missing" });

    // Stripe customer
    let customerStripeId = customer.stripeCustomerId;
    if (!customerStripeId) {
      const newCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
      });
      customerStripeId = newCustomer.id;
      customer.stripeCustomerId = customerStripeId;
      await customer.save();
    }

    // Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerStripeId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "inr",
            product_data: {
              name: serviceDetails.title,
              description: serviceDetails.description || "",
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        application_fee_amount: commission * 100,
        transfer_data: { destination: provider.stripeAccountId },
        metadata: { userId, providerId, serviceId },
      },
      metadata: { userId, providerId, serviceId },
      success_url: `https://yourflutterapp.com/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://yourflutterapp.com/payment-cancel`,
    });

    // Save only payment
    const payment = await Payment.create({
      user: userId,
      provider: providerId,
      service: serviceId,
      checkoutSessionId: session.id,
      customerStripeId,
      providerStripeId: provider.stripeAccountId,
      amount,
      appCommission: commission,
      providerAmount,
      paymentIntentId: session.payment_intent,
      status: "pending",
    });

    res.json({
      isSuccess: true,
      redirectUrl: session.url,
      paymentId: payment._id,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err.message });
  }
};

// -----------------------------
// 2️⃣ Confirm Payment & Create Booking
// -----------------------------
exports.updateBookingStatus = async (req, res) => {
  try {
    const { sessionId } = req.body;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // 🔥 verify actual payment intent status (manual capture flow)
    const paymentIntent = await stripe.paymentIntents.retrieve(
      session.payment_intent
    );

    if (paymentIntent.status !== "requires_capture") {
      return res.status(400).json({ message: "Payment not completed" });
    }

    // Metadata
    const { userId, providerId, serviceId } = session.metadata;

    // Find payment
    const payment = await Payment.findOne({ checkoutSessionId: sessionId });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    // Create booking
    const booking = await Booking.create({
      customer: userId,
      provider: providerId,
      service: serviceId,
      amount: payment.amount,
      status: "booked",
      paymentId: payment._id,
    });

    payment.status = "held";
    payment.paymentIntentId = session.payment_intent;
    payment.bookingId = booking._id;
    await payment.save();
    async function sendBookingNotification(
      customer,
      provider,
      service,
      booking
    ) {
      try {
        console.log("Customer Tokens →", customer.fcmToken);
        console.log("Provider Tokens →", provider.fcmToken);

        // 🎉 Message for Customer
        if (customer.fcmToken?.length > 0) {
          await admin.messaging().sendEachForMulticast({
            tokens: customer.fcmToken,
            notification: {
              title: "🎉 Service Booked Successfully!",
              body: `You booked "${service.title}" with ${provider.name}. Amount: ₹${booking.amount}`,
            },
            data: {
              type: "booking_success",
              userType: "customer",
              bookingId: booking._id.toString(),
            },
          });
        }

        // 🛎 Message for Provider
        if (provider.fcmToken?.length > 0) {
          await admin.messaging().sendEachForMulticast({
            tokens: provider.fcmToken,
            notification: {
              title: "🛎 New Booking Received!",
              body: `${customer.name} booked "${service.title}". Amount: ₹${booking.amount}`,
            },
            data: {
              type: "booking_received",
              userType: "provider",
              bookingId: booking._id.toString(),
            },
          });
        }

        console.log("Notifications sent successfully.");
      } catch (err) {
        console.error("Error sending notification:", err);
      }
    }
    res.json({
      isSuccess: true,
      message: "Booking created after payment success",
      bookingId: booking._id,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err.message });
  }
};



// ------------------------------
// 2) START SERVICE → GENERATE OTP → EMAIL
// ------------------------------
exports.startService = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId)
      .populate("customer")
      .populate("provider")
      .populate("service");

    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const { customer, provider, service } = booking;
    if (!customer || !customer.email)
      return res.status(400).json({ message: "Customer email missing" });

    // Generate OTP
    const { otp, expiry } = generateOTP();
    booking.otp = otp;
    booking.otpExpiry = expiry;
    await booking.save();

    // Send OTP email
    await sendServiceOtpEmail(customer.email, {
      customerName: customer.name,
      providerName: provider.name,
      serviceName: service.title,
      bookingId: booking._id,
      amount: booking.amount,
      otp,
    });

    return res.json({ isSuccess: true, message: "OTP generated & sent", otp }); // otp for testing
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ------------------------------
// 3) VERIFY OTP
// ------------------------------
exports.verifyServiceOtp = async (req, res) => {
  try {
    const { bookingId, otp } = req.body;

    const booking = await Booking.findById(bookingId)
      .populate("customer")
      .populate("provider")
      .populate("service");

    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.otpExpiry < new Date())
      return res.status(400).json({ message: "OTP expired" });

    if (booking.otp != otp)
      return res.status(400).json({ message: "Invalid OTP" });

    booking.status = "started";
    await booking.save();

    // 🎯 Only notify customer
    await sendServiceStartedNotification(
      booking.customer,
      booking.provider,
      booking.service,
      booking
    );

    return res.json({
      isSuccess: true,
      message: "OTP verified & service started",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ------------------------------
// 4) COMPLETE SERVICE + CAPTURE PAYMENT
// ------------------------------
exports.completeService = async (req, res) => {
  try {
    const { bookingId } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    // ❌ If OTP not verified → block completion
    if (booking.status !== "started") {
      return res.status(400).json({
        isSuccess: false,
        message: "Please start the service first by verifying OTP.",
      });
    }

    const payment = await Payment.findById(booking.paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    // Stripe capture
    await stripe.paymentIntents.capture(payment.paymentIntentId);

    booking.status = "completed";
    await booking.save();

    payment.status = "completed";
    payment.completedAt = new Date();
    await payment.save();

    return res.json({
      isSuccess: true,
      message: "Service completed & payment captured",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET USER BOOKINGS (Customer & Provider)
exports.getUserBookings = async (req, res) => {
  try {
    const { userId } = req.body; // ⭐ Body se userId

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Customer bookings
    const customerBookings = await Booking.find({ customer: userId })
      .populate("service")
      .populate("provider", "name email")
      .sort({ createdAt: -1 });

    // Provider bookings
    const providerBookings = await Booking.find({ provider: userId })
      .populate("service")
      .populate("customer", "name email")
      .sort({ createdAt: -1 });

    const bookings = [];

    customerBookings.forEach((b) => {
      bookings.push({
        bookingId: b._id,
        role: "customer",
        service: b.service,
        otherUser: b.provider,
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
        status: b.status,
        amount: b.amount,
        createdAt: b.createdAt,
      });
    });

    bookings.sort((a, b) => b.createdAt - a.createdAt);

    return res.json({ isSuccess: true, bookings });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const CancellationSetting = require("../model/CancellationSetting");

// ------------------------------
// CANCEL BOOKING + PARTIAL REFUND
// ------------------------------
// ------------------------------
// CANCEL BOOKING + PARTIAL REFUND (ALWAYS REFUND EVEN IF NOT CAPTURED)
// ------------------------------
exports.refundBooking = async (req, res) => {
  try {
    console.log("📌 refundBooking called:", req.body);

    const { bookingId } = req.body;

    // 1️⃣ Booking
    console.log("➡ Fetching booking...");
    const booking = await Booking.findById(bookingId);
    console.log("✔ Booking:", booking);

    if (!booking) return res.status(404).json({ message: "Booking not found" });

    console.log("➡ Checking booking status:", booking.status);
    if (booking.status !== "booked") {
      console.log("❌ Booking is not booked");
      return res.status(400).json({
        isSuccess: false,
        message: "Only booked services can be cancelled.",
      });
    }

    // 2️⃣ Payment
    console.log(
      "➡ Fetching Payment using booking.paymentId:",
      booking.paymentId
    );
    let payment = await Payment.findById(booking.paymentId);

    if (!payment) {
      console.log("⚠ paymentId is wrong, trying findOne({ bookingId })");
      payment = await Payment.findOne({ bookingId });
    }

    console.log("✔ Payment:", payment);

    if (!payment) return res.status(404).json({ message: "Payment not found" });

    console.log("➡ Fetching Stripe PaymentIntent...");
    const paymentIntent = await stripe.paymentIntents.retrieve(
      payment.paymentIntentId
    );
    console.log("✔ PaymentIntent:", paymentIntent.status);

    // 3️⃣ Cancellation setting
    console.log("➡ Fetching cancellation settings...");
    const setting = await CancellationSetting.findOne();
    const cancellationPercent = setting?.enabled ? setting.percentage : 0;
    console.log("✔ Cancellation %:", cancellationPercent);

    const totalAmount = payment.amount;
    const cancellationFee = Math.round(
      (totalAmount * cancellationPercent) / 100
    );
    const refundAmount = totalAmount - cancellationFee;

    console.log("💰 Refund Amount:", refundAmount);
    console.log("💰 App Fee:", cancellationFee);

    let refundId = null;

    // Case A: If requires_capture → capture first
    if (paymentIntent.status === "requires_capture") {
      console.log("➡ Capturing PaymentIntent BEFORE refund...");
      await stripe.paymentIntents.capture(payment.paymentIntentId);
      console.log("✔ Payment Captured");
    }

    // Refund
    console.log("➡ Creating refund...");
    const refund = await stripe.refunds.create({
      payment_intent: payment.paymentIntentId,
      amount: refundAmount * 100,
      reason: "requested_by_customer",
    });

    refundId = refund.id;
    console.log("✔ Refund Created:", refundId);

    // Update records
    console.log("➡ Updating booking & payment status...");
    booking.status = "cancelled";
    await booking.save();

    payment.status = "refunded";
    payment.refundedAmount = refundAmount;
    payment.cancellationFee = cancellationFee;
    payment.refundAt = new Date();
    await payment.save();

    console.log("✔ Refund Booking DONE");

    return res.json({
      isSuccess: true,
      message: "Booking cancelled & refund processed.",
      refundAmount,
      cancellationFee,
      refundId,
    });
  } catch (err) {
    console.log("❌ refundBooking ERROR:", err.message);
    return res.status(500).json({ message: err.message });
  }
};
// End of file
