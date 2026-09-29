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
    .replace(/{{amount}}/g, data.amount)
    .replace(/{{otp}}/g, data.otp)
    .replace(/{{date}}/g, new Date().toLocaleDateString());

  await sendEmail({
    to,
    subject: "Your Service Start OTP",
    html,
  });
}
async function sendServiceBookedEmail(
  customer,
  service,
  provider,
  booking,
  type = "customer",
) {
  console.log("📧 sendServiceBookedEmail called for:", type);

  try {
    // Load template
    const templatePath = path.join(__dirname, "../templates/service_book.html");
    let html = fs.readFileSync(templatePath, "utf-8");
    console.log("📂 Template loaded, length:", html.length);

    let toEmail;

    if (type === "customer") {
      toEmail = customer.email;

      // Only show provider info
      const providerSection = `
        <p><strong>Provider:</strong> ${provider.name}</p>
        <p><strong>Provider Email:</strong> ${provider.email}</p>
      `;
      html = html.replace("{{provider_section}}", providerSection);
      html = html.replace("{{customer_section}}", ""); // hide customer section

      html = html.replace(/{{name}}/g, customer.name);
    } else {
      toEmail = provider.email;

      // Only show customer info
      const customerSection = `
        <p><strong>Customer:</strong> ${customer.name}</p>
        <p><strong>Customer Email:</strong> ${customer.email}</p>
      `;
      html = html.replace("{{customer_section}}", customerSection);
      html = html.replace("{{provider_section}}", ""); // hide provider section

      html = html.replace(/{{name}}/g, provider.name);
    }

    // Replace other common placeholders
    html = html
      .replace(/{{service_name}}/g, service.title)
      .replace(
        /{{date}}/g,
        service.date ? new Date(service.date).toLocaleString() : "-",
      )
      .replace(/{{amount}}/g, booking.amount);

    console.log("📩 Placeholders replaced");

    // --- Debug: Send plain text test email first ---

    // --- Send actual HTML email ---
    const info = await sendEmail({
      to: toEmail,
      subject: "Service Booked",
      html,
    });
    console.log("✅ HTML Email sent successfully to:", toEmail);
    console.log("📬 Message ID:", info.messageId);
  } catch (err) {
    console.log("❌ Email sending failed:", err.message);
  }
}
async function sendServiceCompletedEmail(customer, provider, service, booking) {
  try {
    const templatePath = path.join(
      __dirname,
      "../templates/service_completed.html",
    );

    let html = fs.readFileSync(templatePath, "utf8");
    // 📌 Service completed time (NOW)

    // Provider section (for customer)
    const providerHTML = `
      <p style="margin: 6px 0; font-size: 15px">
        <strong>Provider:</strong> ${provider.name}
      </p>
      <p style="margin: 6px 0; font-size: 15px">
       <strong>Phone:</strong> ${provider.mobile || "Not available"}

      </p>
    `;

    // No customer section for customer email
    const customerHTML = ``;

    html = html
      .replace("{{name}}", customer.name)
      .replace("{{service_name}}", service.title)
      .replace("{{provider_section}}", providerHTML)
      .replace("{{customer_section}}", customerHTML)

      .replace("{{amount}}", booking.amount);

    await sendEmail({
      to: customer.email,
      subject: "Service Completed",
      html,
    });

    console.log("📧 Email sent to customer");
  } catch (err) {
    console.error("❌ Email error:", err.message);
  }
}
async function sendServiceCancelledEmail(
  customer,
  provider,
  service,
  booking,
  reason = "",
) {
  console.log("📧 [EMAIL] Function Called");

  try {
    const templatePath = path.join(
      __dirname,
      "../templates/service_cancel.html",
    );

    console.log("📧 Loading Template…");
    let htmlTemplate = fs.readFileSync(templatePath, "utf8");
    console.log("📧 Template Loaded");

    const reasonSection = reason
      ? `
        <p style="margin: 6px 0; font-size: 15px">
          <strong>Reason:</strong> ${reason}
        </p>
      `
      : "";

    // ===============================
    // 📧 CUSTOMER EMAIL
    // ===============================
    console.log("📧 Preparing CUSTOMER email…");

    let customerHtml = htmlTemplate
      .replace("{{name}}", customer.name)
      .replace("{{service_name}}", service.title)
      .replace("{{provider_name}}", provider.name)
      .replace("{{date}}", new Date().toLocaleString("en-IN"))
      .replace("{{refund_amount}}", booking.amount)
      .replace("{{reason_section}}", reasonSection);

    await sendEmail({
      to: customer.email,
      subject: "Service Cancelled",
      html: customerHtml,
    });

    console.log("✅ Email sent to CUSTOMER:", customer.email);

    // ===============================
    // 📧 PROVIDER EMAIL
    // ===============================
    console.log("📧 Preparing PROVIDER email…");

    let providerHtml = htmlTemplate
      .replace("{{name}}", provider.name)
      .replace("{{service_name}}", service.title)
      .replace("{{provider_name}}", provider.name)
      .replace("{{date}}", new Date().toLocaleString("en-IN"))
      .replace("{{refund_amount}}", booking.amount)
      .replace(
        "{{reason_section}}",
        `<p style="margin:6px 0;font-size:15px">
          <strong>Cancelled By:</strong> Customer
        </p>${reasonSection}`,
      );

    await sendEmail({
      to: provider.email,
      subject: "Service Cancelled by Customer",
      html: providerHtml,
    });

    console.log("✅ Email sent to PROVIDER:", provider.email);
  } catch (err) {
    console.error("❌ Cancel Email Error:", err.message);
  }
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
  sendServiceDeleteApprovedEmail,
  sendServiceForceDeletedEmail,
  sendCredentialsEmail,
  sendPromotionStatusEmail,
};
