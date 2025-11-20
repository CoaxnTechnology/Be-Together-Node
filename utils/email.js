// utils/email.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Create a reusable transporter object
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

// ---------------- OTP EMAIL ----------------
async function sendOtpEmail(to, otp) {
  const templatePath = path.join(__dirname, "../templates/email_otp.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  html = html.replace("{{otp_code}}", otp);
  html = html.replace("{{date}}", new Date().toLocaleDateString());

  await transporter.sendMail({
    from: process.env.SMTP_EMAIL,
    to,
    subject: "Your OTP Code",
    html,
  });
}

// ---------------- RESET PASSWORD EMAIL ----------------
async function sendResetEmail(to, token) {
  const FRONTEND_RESET_URL =
    process.env.FRONTEND_RESET_URL ||
    "https://your-frontend.com/reset-password";

  const templatePath = path.join(__dirname, "../templates/email_reset.html");
  let html = fs.readFileSync(templatePath, "utf-8");

  const resetLink = `${FRONTEND_RESET_URL}?token=${token}`;
  html = html.replace("{{reset_link}}", resetLink);
  html = html.replace("{{date}}", new Date().toLocaleString());

  await transporter.sendMail({
    from: process.env.SMTP_EMAIL,
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

  await transporter.sendMail({
    from: process.env.SMTP_EMAIL,
    to,
    subject: "Your Service Start OTP",
    html,
  });
}
async function sendServiceBookedEmail(customer, service, provider, booking, type = "customer") {
  console.log("📧 sendServiceBookedEmail called for:", type);

  try {
    // Load template
    const templatePath = path.join(__dirname, "../templates/service_book.html");
    let html = fs.readFileSync(templatePath, "utf-8");
    console.log("📂 Template loaded, length:", html.length);

    let toEmail;
    let replacements = {};

    if (type === "customer") {
      toEmail = customer.email;

      replacements = {
        name: customer.name,
        provider_name: provider.name,
        provider_email: provider.email,
        customer_name: "-",
        customer_email: "-",
        service_name: service.title,
        date: service.date ? new Date(service.date).toLocaleString() : "-",
        amount: booking.amount,
      };
    } else {
      toEmail = provider.email;

      replacements = {
        name: provider.name,
        provider_name: "-",
        provider_email: "-",
        customer_name: customer.name,
        customer_email: customer.email,
        service_name: service.title,
        date: service.date ? new Date(service.date).toLocaleString() : "-",
        amount: booking.amount,
      };
    }

    // Replace placeholders globally
    Object.keys(replacements).forEach((key) => {
      html = html.replace(new RegExp(`{{${key}}}`, "g"), replacements[key] || "-");
    });
    console.log("📩 Placeholders replaced");

    // --- Debug: Send plain text test email first ---
    await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: toEmail,
      subject: "Test Service Booking Email",
      text: `Hello ${replacements.name}, this is a test email for service booking.`
    });
    console.log("🛠 Test plain text email sent to:", toEmail);

    // --- Send actual HTML email ---
    const info = await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
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


module.exports = {
  sendOtpEmail,
  sendResetEmail,
  sendServiceOtpEmail,
  sendServiceBookedEmail,
};
