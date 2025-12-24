const Admin = require("../model/Admin");
const { decodeToken } = require("../utils/jwt");

async function adminAuth(req, res, next) {
  console.log("🔐 adminAuth MIDDLEWARE START");

  try {
    console.log("📥 Incoming headers:", req.headers);

    const authHeader = req.headers.authorization;
    console.log("🔑 Authorization header:", authHeader);

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("❌ Authorization header missing or invalid");
      return res.status(401).json({
        isSuccess: false,
        message: "Unauthorized",
      });
    }

    const token = authHeader.split(" ")[1];
    console.log("🪙 Extracted token:", token);

    const decoded = decodeToken(token);
    console.log("🔓 Decoded token:", decoded);

    if (!decoded) {
      console.log("❌ Token decode FAILED");
      return res.status(401).json({
        isSuccess: false,
        message: "Invalid or expired token",
      });
    }

    

    console.log("🆔 Decoded admin ID:", decoded.id);

    const admin = await Admin.findById(decoded.id);
    console.log("👤 Admin fetched from DB:", admin);

    if (!admin) {
      console.log("❌ Admin NOT FOUND in DB");
      return res.status(401).json({
        isSuccess: false,
        message: "Admin not found",
      });
    }

    req.admin = {
      id: admin._id,
      role: "admin",
      email: admin.email,
    };

    console.log("✅ adminAuth SUCCESS → req.admin set:", req.admin);
    next();
  } catch (err) {
    console.error("❌ adminAuth CRASH:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
}

module.exports = adminAuth;
