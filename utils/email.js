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
  console.log("📧 sendBookingEmail CALLED for", type);

  try {
    const templatePath = path.join(__dirname, "../templates/service_book.html");
    console.log("📂 Template path:", templatePath);

    let html = fs.readFileSync(templatePath, "utf-8");
    console.log("📄 Template loaded, length:", html.length);

    let toEmail;
    let replacements = {};

    // ------------------------------
    // CUSTOMER EMAIL
    // ------------------------------
    if (type === "customer") {
      toEmail = customer?.email;
      console.log("🟢 Customer email:", toEmail);

      replacements = {
        title: "Service Booked",
        heading: "Your Service Has Been Booked 🎉",
        name: customer.name,
        message: "Your service has been successfully booked.",
        service_name: service.title,
        provider_name: provider.name,
        customer_name: "-",
        customer_email: "-",
        provider_email: provider.email,
        amount: booking.amount,
        booking_date: new Date(booking.createdAt).toLocaleString(),
        service_date: service.date
          ? new Date(service.date).toLocaleString()
          : "-",
      };
    }

    // ------------------------------
    // PROVIDER EMAIL
    // ------------------------------
    else {
      toEmail = provider?.email;
      console.log("🟢 Provider email:", toEmail);

      let serviceDate = "-";
      if (service.service_type === "one_time") {
        serviceDate = service.date
          ? new Date(service.date).toLocaleString()
          : "-";
      } else if (service.service_type === "recurring") {
        serviceDate = service.recurring_schedule
          .map(
            (slot) =>
              `${slot.day} ${slot.start_time}-${slot.end_time} (${new Date(
                slot.date
              ).toLocaleDateString()})`
          )
          .join(", ");
      }

      replacements = {
        title: "New Service Booking",
        heading: "New Service Booking Details",
        name: provider.name,
        message: "A customer has booked your service.",
        service_name: service.title,
        provider_name: "-",
        customer_name: customer.name,
        customer_email: customer.email,
        amount: booking.amount,
        booking_date: new Date(booking.createdAt).toLocaleString(),
        service_date: serviceDate,
      };
    }

    // Replace placeholders
    Object.keys(replacements).forEach((key) => {
      html = html.replace(new RegExp(`{{${key}}}`, "g"), replacements[key] || "-");
    });
    console.log("📩 Placeholders replaced");

    // ------------------------------
    // Check transporter before sending
    // ------------------------------
    console.log("🛠 Sending email via transporter:", transporter.options);

    const info = await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: toEmail,
      subject: replacements.title,
      html,
    });

    console.log("✅ Email Sent Successfully!");
    console.log("📬 Message ID:", info.messageId);
    console.log("📧 Preview URL:", nodemailer.getTestMessageUrl(info));
  } catch (err) {
    console.log("❌ Email Sending Failed:", err.message);
    console.log(err);
  }
}


module.exports = {
  sendOtpEmail,
  sendResetEmail,
  sendServiceOtpEmail,
  sendServiceBookedEmail,
};
