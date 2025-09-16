const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

function createAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" }); // 7 days
}

function decodeToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { createAccessToken, decodeToken };
