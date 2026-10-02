// utils/email.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const { sendEmail } = require("./brevoMailer");
// ---------------- OTP EMAIL ----------------
async function sendOtpEmail(to, otp) {
  const templatePath = path.join(__dirname, "../templates/email_otp.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  html = html.replace("{{otp_code}}", otp);
  html = html.replace("{{date}}", new Date().toLocaleDateString());

  await sendEmail({
    to,
    subject: "Your OTP Code",
    html,
  });
}

// ---------------- RESET PASSWORD EMAIL ----------------
async function sendResetEmail(to, token) {
  const FRONTEND_RESET_URL = process.env.FRONTEND_RESET_URL;

  const templatePath = path.join(__dirname, "../templates/email_reset.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  // ✅ IMPORTANT FIX: email + token BOTH + URL ENCODE
  const resetLink =
    `${FRONTEND_RESET_URL}` +
    `?email=${encodeURIComponent(to)}` +
    `&token=${encodeURIComponent(token)}`;

  console.log("📨 Reset link generated:", resetLink);

  html = html.replace("{{reset_link}}", resetLink);
  html = html.replace("{{date}}", new Date().toLocaleString());

  await sendEmail({
    to,
    subject: "Reset your password",
    html,
  });
}
// ---------------- SERVICE START OTP EMAIL ----------------
async function sendServiceOtpEmail(to, data) {
  const templatePath = path.join(__dirname, "../templates/service_otp.html");
  let html = fs.readFileSync(templatePath, "utf8");

  html = html
    .replace(/{{customerName}}/g, data.customerName)
    .replace(/{{providerName}}/g, data.providerName)
    .replace(/{{serviceName}}/g, data.serviceName)
    .replace(/{{bookingId}}/g, data.bookingId)
    .replace(/{{amount}}/g, formatMoney(data.amount, data.currency))
    .replace(/{{otp}}/g, data.otp)
    .replace(/{{date}}/g, new Date().toLocaleDateString());

  await sendEmail({
    to,
    subject: `Your start code for "${data.serviceName}"`,
    html,
  });
}
// ---------------- BOOKING EMAILS (shared helpers) ----------------
// Every booking email (normal Service and Service Request) is rendered from
// one template, templates/booking_status.html — only the wording, colour and
// detail rows change per case.
const CURRENCY_SYMBOLS = { EUR: "€", INR: "₹", USD: "$", GBP: "£" };

function formatMoney(amount, currency) {
  const value = Number(amount || 0).toFixed(2);
  const code = String(currency || "EUR").toUpperCase();
  return CURRENCY_SYMBOLS[code] ? `${CURRENCY_SYMBOLS[code]}${value}` : `${value} ${code}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// [["Service", "Plumbing"], ["Date", null], …] → <p> rows; empty values skipped.
function detailRows(rows) {
  return rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([label, value]) =>
        `<p style="margin: 6px 0; font-size: 15px"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`,
    )
    .join("\n");
}

function noteBox(text, color = "#16a34a") {
  if (!text) return "";
  return `<div style="margin-top: 20px; border-left: 4px solid ${color}; background: #f8fafc; border-radius: 12px; padding: 14px 16px; text-align: left; font-size: 15px; color: #333">${escapeHtml(text)}</div>`;
}

const BOOKING_TEMPLATE = path.join(__dirname, "../templates/booking_status.html");

async function sendBookingStatusEmail({
  to,
  subject,
  titleText,
  titleColor = "#1f1f1f",
  name,
  introText,
  detailsTitle = "Booking Details",
  rows = [],
  note = "",
  noteColor,
  closingText = "Thank you for using BeTogether.",
}) {
  if (!to) return;
  const html = fs
    .readFileSync(BOOKING_TEMPLATE, "utf8")
    .replace(/{{email_title}}/g, escapeHtml(subject))
    .replace(/{{title_text}}/g, escapeHtml(titleText))
    .replace(/{{title_color}}/g, titleColor)
    .replace(/{{name}}/g, escapeHtml(name || "there"))
    .replace(/{{intro_text}}/g, escapeHtml(introText))
    .replace(/{{details_title}}/g, escapeHtml(detailsTitle))
    .replace(/{{details_rows}}/g, detailRows(rows))
    .replace(/{{note_html}}/g, noteBox(note, noteColor))
    .replace(/{{closing_text}}/g, escapeHtml(closingText))
    .replace(/{{year}}/g, String(new Date().getFullYear()));
  await sendEmail({ to, subject, html });
}

// Sends each email; one failed address never stops the others.
async function sendBoth(...emails) {
  for (const options of emails) {
    try {
      await sendBookingStatusEmail(options);
    } catch (err) {
      console.error("❌ Booking email error:", err.message);
    }
  }
}

const POLICY_TEXT = {
  late_fee: "Free until 1 hour before the start — a late cancellation fee applies after that",
  free: "Free cancellation at any time",
};

function serviceWhen(service) {
  if (!service?.date) return null;
  return [service.date, service.start_time].filter(Boolean).join(" ");
}

function requestWhen(request) {
  if (!request?.schedule?.date) return null;
  return [request.schedule.date, request.schedule.startTime].filter(Boolean).join(" ");
}

// =====================================================================
// NORMAL SERVICE BOOKINGS
// =====================================================================
async function sendServiceBookedEmail(customer, service, provider, booking, type = "customer") {
  try {
    const currency = service?.currency;
    const common = [
      ["Service", service?.title],
      ["Date", serviceWhen(service)],
      ["Booking ID", booking?._id],
    ];
    if (type === "customer") {
      await sendBookingStatusEmail({
        to: customer.email,
        subject: `Booking confirmed — ${service?.title}`,
        titleText: "Your Booking Is Confirmed 🎉",
        name: customer.name,
        introText: `Your payment was successful and your booking with ${provider.name} is confirmed.`,
        rows: [
          ...common,
          ["Provider", provider.name],
          ["Provider email", provider.email],
          ["Service price", formatMoney(booking?.amount, currency)],
        ],
        closingText:
          "Your provider will share a start code (OTP) with you on the day — keep this booking handy.",
      });
    } else {
      await sendBookingStatusEmail({
        to: provider.email,
        subject: `New booking — ${service?.title}`,
        titleText: "You Have a New Booking 🎉",
        name: provider.name,
        introText: `${customer.name} has booked your service.`,
        rows: [
          ...common,
          ["Customer", customer.name],
          ["Customer phone", booking?.contactPhone],
          ["Service price", formatMoney(booking?.amount, currency)],
        ],
        closingText:
          "Start the service from the app when you arrive — the customer gets an OTP to confirm. Your payout is sent when you complete it.",
      });
    }
    console.log("✅ Booked email sent:", type);
  } catch (err) {
    console.log("❌ Email sending failed:", err.message);
  }
}

// extra: { currency, providerAmount } — providerAmount = the payout sent.
async function sendServiceCompletedEmail(customer, provider, service, booking, extra = {}) {
  const currency = extra.currency || service?.currency;
  const rows = [
    ["Service", service?.title],
    ["Booking ID", booking?._id],
    ["Service price", formatMoney(booking?.amount, currency)],
  ];
  const isFree = !booking?.amount;
  await sendBoth(
    {
      to: customer.email,
      subject: `Service completed — ${service?.title}`,
      titleText: "Service Completed ✅",
      titleColor: "#16a34a",
      name: customer.name,
      introText: `${provider.name} has marked your service as completed.`,
      rows: [...rows, ["Provider", provider.name], ["Provider phone", provider.mobile]],
      closingText: "We hope it went well! You can now rate your provider in the app.",
    },
    {
      to: provider.email,
      subject: `Service completed — ${service?.title}`,
      titleText: "Service Completed ✅",
      titleColor: "#16a34a",
      name: provider.name,
      introText: `You completed the service for ${customer.name}.`,
      rows,
      note:
        !isFree && extra.providerAmount !== undefined
          ? `Payout of ${formatMoney(extra.providerAmount, currency)} has been sent to your Stripe account (after platform commission).`
          : "",
      closingText: "Thank you for providing a great service on BeTogether.",
    },
  );
}

// extra: { cancelledBy: "customer"|"provider", refundAmount, cancellationFee, currency }
async function sendServiceCancelledEmail(
  customer,
  provider,
  service,
  booking,
  reason = "",
  extra = {},
) {
  const currency = extra.currency || service?.currency;
  const byProvider = extra.cancelledBy === "provider";
  const isFree = !booking?.amount;
  const refundAmount = extra.refundAmount ?? (isFree ? 0 : booking?.amount);
  const fee = Number(extra.cancellationFee || 0);
  const rows = [
    ["Service", service?.title],
    ["Date", serviceWhen(service)],
    ["Booking ID", booking?._id],
    ["Cancelled by", byProvider ? `${provider.name} (provider)` : `${customer.name} (customer)`],
    ["Reason", reason],
  ];
  const moneyRows = isFree
    ? []
    : [
        ["Refund to customer", formatMoney(refundAmount, currency)],
        ["Cancellation fee", fee > 0 ? formatMoney(fee, currency) : null],
      ];
  await sendBoth(
    {
      to: customer.email,
      subject: byProvider
        ? `Your booking was cancelled by the provider — ${service?.title}`
        : `Booking cancelled — ${service?.title}`,
      titleText: "Booking Cancelled ❌",
      titleColor: "#e63946",
      name: customer.name,
      introText: byProvider
        ? `${provider.name} had to cancel your booking.`
        : "Your booking has been cancelled as requested.",
      rows: [...rows, ...moneyRows],
      note: isFree
        ? ""
        : `${formatMoney(refundAmount, currency)} is being refunded to your original payment method. It usually appears within 5–10 business days.`,
      closingText: "You can book another service anytime on BeTogether.",
    },
    {
      to: provider.email,
      subject: byProvider
        ? `You cancelled a booking — ${service?.title}`
        : `Booking cancelled by customer — ${service?.title}`,
      titleText: "Booking Cancelled ❌",
      titleColor: "#e63946",
      name: provider.name,
      introText: byProvider
        ? `You cancelled ${customer.name}'s booking. The customer receives a full refund.`
        : `${customer.name} cancelled their booking.`,
      rows: [...rows, ...moneyRows],
      closingText: "This time slot is free again.",
    },
  );
}

// =====================================================================
// SERVICE REQUEST BOOKINGS
// Paid (paid_fixed / paid_offer): booking.customer = customer,
// booking.provider = provider. Free join (free_single / free_group):
// booking.customer = the participant, booking.provider = the host.
// =====================================================================
function requestRows(request, booking) {
  return [
    ["Request", request?.title],
    ["When", requestWhen(request)],
    ["Booking ID", booking?._id],
  ];
}

// After the first payment (paid) or a successful join (free).
async function sendRequestBookedEmail({ customer, provider, request, booking, payment }) {
  const isFree = !booking?.amount;
  const rows = requestRows(request, booking);
  if (isFree) {
    await sendBoth(
      {
        to: customer.email,
        subject: `You joined "${request?.title}"`,
        titleText: "You're In! 🎉",
        titleColor: "#16a34a",
        name: customer.name,
        introText: `You have joined ${provider.name}'s request.`,
        detailsTitle: "Request Details",
        rows: [...rows, ["Host", provider.name]],
        closingText: "Changed your plans? You can leave the request from the app.",
      },
      {
        to: provider.email,
        subject: `New participant — ${request?.title}`,
        titleText: "Someone Joined Your Request 🎉",
        titleColor: "#16a34a",
        name: provider.name,
        introText: `${customer.name} joined your request.`,
        detailsTitle: "Request Details",
        rows: [...rows, ["Participant", customer.name], ["Participant phone", booking?.contactPhone]],
        closingText: "You'll see every participant in the app.",
      },
    );
    return;
  }

  const currency = payment?.currency;
  const policy = POLICY_TEXT[booking?.cancellationPolicy || payment?.cancellationPolicy];
  await sendBoth(
    {
      to: customer.email,
      subject: `Request booking confirmed — ${request?.title}`,
      titleText: "Your Request Is Booked 🎉",
      name: customer.name,
      introText: `Your payment was successful and ${provider.name} is booked for your request.`,
      detailsTitle: "Request Booking Details",
      rows: [
        ...rows,
        ["Provider", provider.name],
        ["Price", formatMoney(payment?.originalAmount ?? booking?.amount, currency)],
        ["You paid", formatMoney(payment?.customerPaidAmount, currency)],
        ["Cancellation", policy],
      ],
      note: "Your payment is held safely by BeTogether and only released to the provider once the job is completed.",
      closingText:
        "When the provider arrives they'll start the job with a code (OTP) sent to you. If the job turns out different, they may propose a new price — you'll be asked to approve it first.",
    },
    {
      to: provider.email,
      subject: `New request booking — ${request?.title}`,
      titleText: "You Have a New Request Booking 🎉",
      name: provider.name,
      introText: `${customer.name} booked you for their request.`,
      detailsTitle: "Request Booking Details",
      rows: [
        ...rows,
        ["Customer", customer.name],
        ["Customer phone", booking?.contactPhone],
        ["Price", formatMoney(payment?.originalAmount ?? booking?.amount, currency)],
        ["Your payout", formatMoney(payment?.providerAmount, currency)],
        ["Cancellation", policy],
      ],
      closingText:
        "On arrival, either start the job (the customer gets an OTP) or propose a new price first if the work is different. Your payout is sent when you complete it.",
    },
  );
}

async function sendRequestCompletedEmail({ customer, provider, request, booking, payment }) {
  const isFree = !booking?.amount;
  const currency = payment?.currency;
  const rows = requestRows(request, booking);
  const priceRows = isFree
    ? []
    : [
        ["Original price", booking?.initialAmount && booking.initialAmount !== booking.amount
          ? formatMoney(booking.initialAmount, currency)
          : null],
        ["Final price", formatMoney(booking?.amount, currency)],
      ];
  await sendBoth(
    {
      to: customer.email,
      subject: `Completed — ${request?.title}`,
      titleText: isFree ? "Request Completed ✅" : "Job Completed ✅",
      titleColor: "#16a34a",
      name: customer.name,
      introText: isFree
        ? `${provider.name} marked "${request?.title}" as completed.`
        : `${provider.name} has completed your request.`,
      detailsTitle: "Request Details",
      rows: [...rows, [isFree ? "Host" : "Provider", provider.name], ...priceRows],
      closingText: "We hope it went well! You can now leave a rating in the app.",
    },
    {
      to: provider.email,
      subject: `Completed — ${request?.title}`,
      titleText: isFree ? "Request Completed ✅" : "Job Completed ✅",
      titleColor: "#16a34a",
      name: provider.name,
      introText: isFree
        ? `"${request?.title}" with ${customer.name} is marked as completed.`
        : `You completed ${customer.name}'s request.`,
      detailsTitle: "Request Details",
      rows: [...rows, [isFree ? "Participant" : "Customer", customer.name], ...priceRows],
      note: isFree
        ? ""
        : `Payout of ${formatMoney(payment?.providerAmount, currency)} has been sent to your Stripe account in one transfer (after platform commission).`,
      closingText: "Thank you for using BeTogether.",
    },
  );
}

// Same cases as the "request_booking_cancelled" push notification.
async function sendRequestCancelledEmail({
  customer,
  provider,
  request,
  booking,
  cancelledBy,
  byAdmin = false,
  reason = "",
  refundAmount = 0,
  cancellationFee = 0,
  providerFeeShare = 0,
  currency = "",
}) {
  const isFree = !booking?.amount;
  const customerCancelled = cancelledBy !== "provider";
  const title = request?.title;
  const by = byAdmin ? "BeTogether support" : null;
  const rows = [
    ...requestRows(request, booking),
    [
      "Cancelled by",
      by ||
        (customerCancelled
          ? `${customer.name} (${isFree ? "participant" : "customer"})`
          : `${provider.name} (${isFree ? "host" : "provider"})`),
    ],
    ["Reason", reason],
  ];
  const red = "#e63946";

  if (isFree) {
    await sendBoth(
      {
        to: customer.email,
        subject: customerCancelled ? `You left "${title}"` : `Your spot in "${title}" was cancelled`,
        titleText: customerCancelled ? "You Left the Request" : "Your Spot Was Cancelled ❌",
        titleColor: red,
        name: customer.name,
        introText: customerCancelled
          ? `You cancelled your spot in "${title}".`
          : `${by || provider.name} cancelled your spot in "${title}".`,
        detailsTitle: "Request Details",
        rows,
        closingText: "You can join other requests anytime on BeTogether.",
      },
      {
        to: provider.email,
        subject: customerCancelled
          ? `A participant left "${title}"`
          : `Participant removed from "${title}"`,
        titleText: customerCancelled ? "A Participant Left 👋" : "Participant Removed",
        titleColor: red,
        name: provider.name,
        introText: customerCancelled
          ? `${customer.name} cancelled their spot in your request.`
          : `${by || "You"} removed ${customer.name} from your request.`,
        detailsTitle: "Request Details",
        rows,
        closingText: "The spot is open again for someone else to join.",
      },
    );
    return;
  }

  const moneyRows = [
    ["Refund to customer", formatMoney(refundAmount, currency)],
    ["Late cancellation fee", cancellationFee > 0 ? formatMoney(cancellationFee, currency) : null],
  ];
  await sendBoth(
    {
      to: customer.email,
      subject: customerCancelled
        ? `Request booking cancelled — ${title}`
        : `Your request booking was cancelled — ${title}`,
      titleText: "Request Booking Cancelled ❌",
      titleColor: red,
      name: customer.name,
      introText: customerCancelled
        ? `Your request booking for "${title}" has been cancelled as requested.`
        : `${by || provider.name} cancelled your request booking for "${title}".`,
      detailsTitle: "Request Booking Details",
      rows: [...rows, ...moneyRows],
      note:
        cancellationFee > 0
          ? `${formatMoney(refundAmount, currency)} is being refunded (a late cancellation fee of ${formatMoney(cancellationFee, currency)} applied because you cancelled less than 1 hour before the start). It usually appears within 5–10 business days.`
          : `${formatMoney(refundAmount, currency)} is being refunded in full to your original payment method. It usually appears within 5–10 business days.`,
      noteColor: cancellationFee > 0 ? "#d97706" : "#16a34a",
      closingText: customerCancelled
        ? "You can post a new request anytime."
        : "Your request is open again — you can accept another offer or post a new request.",
    },
    {
      to: provider.email,
      subject: customerCancelled
        ? `Request booking cancelled by customer — ${title}`
        : `Request booking cancelled — ${title}`,
      titleText: "Request Booking Cancelled ❌",
      titleColor: red,
      name: provider.name,
      introText: customerCancelled
        ? `${customer.name} cancelled their request booking.`
        : by
          ? `${by} cancelled this request booking. The customer receives a full refund.`
          : "You cancelled this request booking. The customer receives a full refund.",
      detailsTitle: "Request Booking Details",
      rows: [...rows, ...moneyRows],
      note:
        providerFeeShare > 0
          ? `You'll receive ${formatMoney(providerFeeShare, currency)} from the late cancellation fee.`
          : "",
      closingText: "Thank you for using BeTogether.",
    },
  );
}

// ---------------- PROMOTION SUBSCRIPTION EMAIL ----------------
// One shared template (promotion_status.html) for all three subscription
// events — only the text/color per eventType changes, same structure as
// every other status email in this file (logo, white card, details box,
// footer). eventType is one of "purchased" | "renewed" | "cancelled".
const PROMOTION_EMAIL_CONFIG = {
  purchased: {
    title_icon: "🚀",
    title_text: "Promotion Activated!",
    title_color: "#16a34a",
    intro_text:
      "Great news — your promotion is now live and boosting your service's visibility.",
    status_label: "Active",
    date_label: "Active Until",
    closing_text:
      "Your service will now appear with priority placement to nearby customers.",
    subject: "Your Promotion is Live 🚀",
  },
  renewed: {
    title_icon: "✅",
    title_text: "Promotion Renewed",
    title_color: "#16a34a",
    intro_text: "Your promotion subscription has been renewed successfully.",
    status_label: "Active",
    date_label: "Active Until",
    closing_text:
      "Your service continues to get boosted visibility — no action needed from you.",
    subject: "Your Promotion Has Been Renewed",
  },
  cancelled: {
    title_icon: "🛑",
    title_text: "Promotion Cancelled",
    title_color: "#e63946",
    intro_text:
      "We're confirming that your promotion subscription has been cancelled.",
    status_label: "Cancelled",
    date_label: "Was Active Until",
    closing_text:
      "Your service has returned to normal listing. You can start a new promotion anytime.",
    subject: "Your Promotion Has Been Cancelled",
  },
};

async function sendPromotionStatusEmail(owner, serviceTitle, eventType, endDate) {
  const cfg = PROMOTION_EMAIL_CONFIG[eventType];
  if (!owner?.email || !cfg) return;

  try {
    const templatePath = path.join(
      __dirname,
      "../templates/promotion_status.html",
    );
    const htmlTemplate = fs.readFileSync(templatePath, "utf8");

    const dateValue = endDate
      ? new Date(endDate).toLocaleDateString("en-IN")
      : "N/A";

    const html = htmlTemplate
      .replace("{{email_title}}", cfg.title_text)
      .replace("{{title_icon}}", cfg.title_icon)
      .replace("{{title_text}}", cfg.title_text)
      .replace("{{title_color}}", cfg.title_color)
      .replace("{{name}}", owner.name || "there")
      .replace("{{intro_text}}", cfg.intro_text)
      .replace("{{service_name}}", serviceTitle || "your service")
      .replace("{{status_label}}", cfg.status_label)
      .replace("{{date_label}}", cfg.date_label)
      .replace("{{date_value}}", dateValue)
      .replace("{{closing_text}}", cfg.closing_text);

    await sendEmail({ to: owner.email, subject: cfg.subject, html });
    console.log(`✅ Promotion "${eventType}" email sent to`, owner.email);
  } catch (err) {
    console.error("❌ Promotion status email error:", err.message);
  }
}

const Admin = require("../model/Admin");
// adjust path if needed
async function sendServiceDeleteApprovedEmail(
  receiver,
  service,
  type = "customer", // customer | provider
) {
  console.log("📧 ===============================");
  console.log("📧 sendServiceDeleteApprovedEmail CALLED");
  console.log("📧 User Type:", type);
  console.log("📧 Receiver Email:", receiver?.email);

  try {
    // ================= EMAIL VALIDATION =================
    if (
      !receiver?.email ||
      typeof receiver.email !== "string" ||
      !receiver.email.trim().includes("@")
    ) {
      console.log(
        `⚠️ [EMAIL SKIPPED] Invalid or missing email → ${receiver?.email}`,
      );
      console.log("📧 ===============================");
      return;
    }

    console.log("✅ Email validation passed");

    // ================= FETCH ADMIN SUPPORT DETAILS =================
    console.log("📧 Fetching admin support details...");
    const admin = await Admin.findOne({ is_active: true }).lean();

    console.log("📧 Admin Support:", {
      phone: admin?.supportPhone,
      email: admin?.supportEmail,
      time: admin?.supportTime,
    });

    // ================= LOAD TEMPLATE =================
    console.log("📧 Loading email template...");
    const templatePath = path.join(
      __dirname,
      "../templates/service_cancel_admin.html",
    );

    let html = fs.readFileSync(templatePath, "utf8");
    console.log("📧 Template loaded");

    // ================= BUILD CONTENT =================
    let heading = "";
    let commonMessage = "";
    let extraSection = "";

    if (type === "customer") {
      console.log("📧 Preparing CUSTOMER email");

      heading = "❌ Service Cancelled & Refund Initiated";
      commonMessage = `
        <p>The service you subscribed to has been cancelled.</p>
        <p>Your refund has been initiated and will be credited within a few hours.</p>
        <p>If you need help, please contact support.</p>
      `;
    } else {
      console.log("📧 Preparing PROVIDER email");

      heading = "✅ Service Delete Request Approved";
      commonMessage = `
        <p>Your service delete request has been approved by the admin.</p>
        <p>The service has been removed successfully.</p>
        <p>If you need help, please contact support.</p>
      `;
    }

    // ================= TEMPLATE REPLACEMENT =================
    console.log("📧 Replacing template variables...");

    html = html
      .replace(/{{heading}}/g, heading)
      .replace(/{{name}}/g, "User")
      .replace(/{{service_name}}/g, service?.title || "Service")
      .replace(/{{date}}/g, new Date().toLocaleString("en-IN"))
      .replace(/{{common_message}}/g, commonMessage)
      .replace(/{{extra_section}}/g, extraSection)
      .replace(/{{support_phone}}/g, admin?.supportPhone || "N/A")
      .replace(/{{support_email}}/g, admin?.supportEmail || "N/A")
      .replace(/{{support_time}}/g, admin?.supportTime || "");

    console.log("📧 Template ready");

    // ================= SEND EMAIL =================
    console.log("📧 Sending email to:", receiver.email.trim());

    await sendEmail({
      to: receiver.email.trim(),
      subject:
        type === "customer"
          ? "Service Cancelled & Refund Initiated"
          : "Service Delete Request Approved",
      html,
    });

    console.log(`✅ Email sent successfully → ${receiver.email}`);
    console.log("📧 ===============================");
  } catch (err) {
    console.error("❌ EMAIL SEND FAILED");
    console.error("❌ Error:", err.message);
    console.log("📧 ===============================");
  }
}

async function sendServiceForceDeletedEmail(
  receiver,
  service,
  type = "customer", // customer | provider
) {
  console.log("📧 ===============================");
  console.log("📧 sendServiceForceDeletedEmail CALLED");
  console.log("📧 Type:", type);
  console.log("📧 Receiver:", receiver?.email);

  try {
    // ================= EMAIL VALIDATION =================
    if (
      !receiver?.email ||
      typeof receiver.email !== "string" ||
      !receiver.email.trim().includes("@")
    ) {
      console.log("⚠️ Invalid email, skipping");
      return;
    }

    // ================= FETCH ADMIN SUPPORT =================
    const admin = await Admin.findOne({ is_active: true }).lean();

    // ================= LOAD TEMPLATE =================
    const templatePath = path.join(
      __dirname,
      "../templates/service_cancel_admin.html",
    );
    let html = fs.readFileSync(templatePath, "utf8");

    let heading = "";
    let subject = "";
    let commonMessage = "";

    // ================= CUSTOMER EMAIL =================
    if (type === "customer") {
      heading = "❌ Service Cancelled & Refund Initiated";
      subject = "Service Cancelled & Refund Initiated";

      commonMessage = `
        <p>
          We regret to inform you that the service you subscribed to has been cancelled
          following an administrative review, as it did not meet our platform guidelines.
        </p>

        <p>
          We understand this may be inconvenient, especially if you were awaiting the service.
          Please be assured that the full payment you made will be refunded within the next few hours.
        </p>

        <p>
          If you require any further clarification or assistance, please feel free to contact
          our admin team at <strong>${admin?.supportPhone || "N/A"}</strong>.
        </p>

        <p>
          Thank you for your understanding and cooperation.
        </p>

        <p>
          Kind regards,<br />
          <strong>Admin Team</strong>
        </p>
      `;
    }

    // ================= PROVIDER EMAIL =================
    if (type === "provider") {
      heading = "⚠️ Service Removed by Admin";
      subject = "Service Removal Notification";

      commonMessage = `
        <p>
          We would like to inform you that the service you listed on our platform has been
          removed following an administrative review, as it was found to be non-compliant
          with our platform guidelines and content policies.
        </p>

        <p>
          As a result, any active subscriptions related to this service have been cancelled,
          and customers have been refunded accordingly.
        </p>

        <p>
          We encourage you to review our service listing policies carefully before submitting
          or publishing future services to avoid similar actions. Repeated violations may
          result in further restrictions on your account.
        </p>

        <p>
          If you believe this action was taken in error or require clarification, you may
          contact the admin team at <strong>${admin?.supportPhone || "N/A"}</strong> /
          <strong>${admin?.supportEmail || "N/A"}</strong> within the specified review period.
        </p>

        <p>
          Thank you for your cooperation.
        </p>

        <p>
          Kind regards,<br />
          <strong>Admin Team</strong>
        </p>
      `;
    }

    // ================= TEMPLATE REPLACEMENT =================
    html = html
      .replace(/{{heading}}/g, heading)
      .replace(/{{name}}/g, receiver?.name || "User")
      .replace(/{{service_name}}/g, service?.title || "Service")
      .replace(/{{date}}/g, new Date().toLocaleString("en-IN"))
      .replace(/{{common_message}}/g, commonMessage)
      .replace(/{{extra_section}}/g, "")
      .replace(/{{support_phone}}/g, admin?.supportPhone || "N/A")
      .replace(/{{support_email}}/g, admin?.supportEmail || "N/A")
      .replace(/{{support_time}}/g, admin?.supportTime || "");

    // ================= SEND EMAIL =================
    await sendEmail({
      to: receiver.email.trim(),
      subject,
      html,
    });

    console.log(`✅ Force delete email sent → ${receiver.email}`);
    console.log("📧 ===============================");
  } catch (err) {
    // 🔥 IMPORTANT: Email failure should NOT affect API
    console.error(
      `❌ Force delete email failed for ${receiver?.email}:`,
      err.message,
    );
    console.log("📧 ===============================");
  }
}
async function sendCredentialsEmail(to, email, token) {
  const FRONTEND_RESET_URL = process.env.FRONTEND_RESET_URL;

  const templatePath = path.join(
    __dirname,
    "../templates/ambassador_credentials.html",
  );

  let html = fs.readFileSync(templatePath, "utf-8");

  const resetLink =
    `${FRONTEND_RESET_URL}` +
    `?email=${encodeURIComponent(email)}` +
    `&token=${encodeURIComponent(token)}`;

  html = html.replace("{{email}}", email);
  html = html.replace("{{reset_link}}", resetLink);
  html = html.replace("{{date}}", new Date().toLocaleDateString());

  await sendEmail({
    to,
    subject: "Welcome to BeTogether",
    html,
  });
}

module.exports = {
  sendOtpEmail,
  sendResetEmail,
  sendServiceOtpEmail,
  sendServiceBookedEmail,
  sendServiceCompletedEmail,
  sendServiceCancelledEmail,
  sendRequestBookedEmail,
  sendRequestCompletedEmail,
  sendRequestCancelledEmail,
  sendServiceDeleteApprovedEmail,
  sendServiceForceDeletedEmail,
  sendCredentialsEmail,
  sendPromotionStatusEmail,
};
