const User = require("../model/User");
const { decodeToken } = require("../utils/jwt");

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ IsSucces: false, message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = decodeToken(token);

    if (!decoded) {
      return res
        .status(401)
        .json({ IsSucces: false, message: "Invalid or expired token" });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res
        .status(401)
        .json({ IsSucces: false, message: "User not found" });
    }

    // Check session
    if (user.session_id !== decoded.session_id) {
      return res
        .status(401)
        .json({ IsSucces: false, message: "Logged in from another device" });
    }

    req.user = user; // attach user to request
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ IsSucces: false, message: "Server error" });
  }
}

module.exports = authMiddleware;
