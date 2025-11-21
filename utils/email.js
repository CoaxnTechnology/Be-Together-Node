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
async function sendServiceBookedEmail(
  customer,
  service,
  provider,
  booking,
  type = "customer"
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
        service.date ? new Date(service.date).toLocaleString() : "-"
      )
      .replace(/{{amount}}/g, booking.amount);

    console.log("📩 Placeholders replaced");

    // --- Debug: Send plain text test email first ---
    await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: toEmail,
      subject: "Test Service Booking Email",
      text: `Hello ${
        type === "customer" ? customer.name : provider.name
      }, this is a test email for service booking.`,
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
async function sendServiceCompletedEmail(customer, provider, service, booking) {
  try {
    const templatePath = path.join(
      __dirname,
      "../templates/service_completed.html"
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

    await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: customer.email,
      subject: "Service Completed",
      html,
    });

    console.log("📧 Email sent to customer");
  } catch (err) {
    console.error("❌ Email error:", err.message);
  }
}

module.exports = {
  sendOtpEmail,
  sendResetEmail,
  sendServiceOtpEmail,
  sendServiceBookedEmail,
  sendServiceCompletedEmail,
};
