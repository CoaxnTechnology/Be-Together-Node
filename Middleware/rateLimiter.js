const rateLimit = require("express-rate-limit");

const resendOtpLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 min window
  max: 3,                  // max 3 requests per IP
  message: {
    IsSucces: false,
    message: "Too many OTP requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { resendOtpLimiter };
