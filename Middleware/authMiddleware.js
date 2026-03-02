const User = require("../model/User");
const { decodeToken } = require("../utils/jwt");

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = decodeToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_INVALID",
        message: "Invalid or expired token",
      });
    }

    const user = await User.findById(decoded.id).select(
      "_id status is_active session_id",
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    // 🔴 BLOCK CHECK (CORRECT PLACE)
    if (user.status === "banned" || user.is_active === false) {
      return res.status(403).json({
        success: false,
        code: "USER_BLOCKED",
        message: "Your account has been blocked by admin",
      });
    }

    // 🔐 SESSION CHECK
    if (user.session_id !== decoded.session_id) {
      return res.status(401).json({
        success: false,
        code: "SESSION_EXPIRED",
        message: "Logged in from another device",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("❌ Auth Middleware Error:", err);
    res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Server error",
    });
  }
}

module.exports = authMiddleware;