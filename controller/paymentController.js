const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const {
  sendServiceOtpEmail,
  sendServiceBookedEmail,
} = require("../utils/email");
const { generateOTP } = require("../utils/otp");

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

// ------------------------------
// 1) BOOK SERVICE + CREATE BOOKING
// ------------------------------
exports.bookService = async (req, res) => {
  try {
    const { userId, providerId, serviceId, amount, paymentMethodId } = req.body;

    // 1️⃣ Fetch commission settings
    const commissionSetting = await CommissionSetting.findOne();
    const commissionPercent = commissionSetting?.percentage || 20;
    const commission = Math.round((amount * commissionPercent) / 100);
    const providerAmount = amount - commission;

    // 2️⃣ Fetch user, provider & service
    const customer = await User.findById(userId);
    const provider = await User.findById(providerId);
    const serviceDetails = await Service.findById(serviceId);

    if (!customer || !provider || !serviceDetails)
      return res.status(404).json({ message: "Data not found" });

    // 3️⃣ Create Stripe Customer if not exists
    let customerStripeId = customer.stripeCustomerId;
    if (!customerStripeId) {
      const newStripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
      });
      customerStripeId = newStripeCustomer.id;
      customer.stripeCustomerId = customerStripeId;
      await customer.save();
    }

    if (!provider.stripeAccountId)
      return res.status(400).json({ message: "Provider stripe account missing" });

    // 4️⃣ Create Booking first
    const booking = await Booking.create({
      customer: userId,
      provider: providerId,
      service: serviceId,
      amount,
      status: "pending_payment", // temporary status
    });

    // 5️⃣ Create Stripe Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: "inr",
      customer: customerStripeId,
      payment_method: paymentMethodId,
      confirm: true,
      capture_method: "manual",
      application_fee_amount: commission * 100,
      transfer_data: { destination: provider.stripeAccountId },
      description: `Service Booking: ${serviceId}`,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });

    // 6️⃣ Save Payment record
    const payment = await Payment.create({
      user: userId,
      provider: providerId,
      service: serviceId,
      bookingId: booking._id.toString(),
      paymentIntentId: paymentIntent.id,
      customerStripeId,
      providerStripeId: provider.stripeAccountId,
      amount,
      appCommission: commission,
      providerAmount,
      status: "pending",
    });

    // 7️⃣ Update booking status based on payment
    if (paymentIntent.status === "succeeded" || paymentIntent.status === "requires_capture") {
      booking.status = "booked";
      await booking.save();

      // 8️⃣ Send Booking Email
      await sendServiceBookedEmail(customer, serviceDetails, provider, booking);
    } else {
      booking.status = "payment_failed";
      await booking.save();
    }

    return res.status(200).json({
      isSuccess: true,
      message: "Booking processed",
      bookingId: booking._id,
      clientSecret: paymentIntent.client_secret,
      paymentStatus: paymentIntent.status,
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: err.message });
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
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.otpExpiry < new Date())
      return res.status(400).json({ message: "OTP expired" });
    if (booking.otp != otp)
      return res.status(400).json({ message: "Invalid OTP" });

    booking.status = "started";
    await booking.save();

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

    const payment = await Payment.findById(booking.paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

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
    const userId = req.params.userId; // logged-in user ID

    // 1️⃣ Bookings jisme user customer hai
    const customerBookings = await Booking.find({ customer: userId })
      .populate("service")
      .populate("provider", "name email")
      .sort({ createdAt: -1 });

    // 2️⃣ Bookings jisme user provider hai
    const providerBookings = await Booking.find({ provider: userId })
      .populate("service")
      .populate("customer", "name email")
      .sort({ createdAt: -1 });

    // 3️⃣ Merge & format response
    const bookings = [];

    customerBookings.forEach((b) => {
      bookings.push({
        bookingId: b._id,
        role: "customer",
        service: b.service,
        otherUser: b.provider, // provider info
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
        otherUser: b.customer, // customer info
        status: b.status,
        amount: b.amount,
        createdAt: b.createdAt,
      });
    });

    // Sort all bookings by latest first
    bookings.sort((a, b) => b.createdAt - a.createdAt);

    return res.json({ isSuccess: true, bookings });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: err.message });
  }
};
