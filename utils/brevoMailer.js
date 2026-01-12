const axios = require("axios");

async function sendEmail({ to, subject, html }) {
  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "BeTogether",
          email: "coaxntechnology@gmail.com",
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    console.log("✅ Brevo email sent to:", to);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Brevo email failed:",
      error.response?.data || error.message
    );
    throw new Error("EMAIL_SEND_FAILED");
  }
}

module.exports = { sendEmail };
