const Admin = require("../model/Admin");
const { decodeToken } = require("../utils/jwt");

async function adminAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        isSuccess: false,
        message: "Unauthorized",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = decodeToken(token);

    if (!decoded) {
      return res.status(401).json({
        isSuccess: false,
        message: "Invalid or expired token",
      });
    }

    console.log("🔐 Decoded admin token:", decoded);

    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res.status(401).json({
        isSuccess: false,
        message: "Admin not found",
      });
    }

    // ✅ NO session check
    req.user = {
      id: admin._id,
      role: "admin",
    };

    next();
  } catch (err) {
    console.error("❌ adminAuth error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
}

module.exports = adminAuth;
