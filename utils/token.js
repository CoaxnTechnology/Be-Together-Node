const crypto = require("crypto");

function createResetToken() {
  // 32 bytes -> hex string (64 chars)
  const token = crypto.randomBytes(32).toString("hex");
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hashed };
}

module.exports = { createResetToken };
