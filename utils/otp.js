const random = require("crypto");

function generateOTP() {
  const otp = ("" + Math.floor(1000 + Math.random() * 9000)).substring(0, 4); // 4-digit
  const expiry = new Date(Date.now() + 2 * 60 * 1000); // 2 min expiry
  return { otp, expiry };
}

module.exports = { generateOTP };
