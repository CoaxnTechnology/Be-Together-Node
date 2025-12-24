const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
console.log("🧨 JWT_SECRET USED BY SERVER =", process.env.JWT_SECRET);

function createAccessToken(payload) {
  console.log("🧾 Creating JWT with payload:", payload);
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function decodeToken(token) {
  try {
    console.log("🔍 Verifying token...");
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    console.log("❌ JWT verification failed:", err.message);
    return null;
  }
}

module.exports = { createAccessToken, decodeToken };
