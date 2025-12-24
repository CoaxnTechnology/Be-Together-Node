const bcrypt = require("bcryptjs");
const Admin = require("../model/Admin");
const { sendOtpEmail } = require("../utils/email");

// ================= SUPPORT INFO (TEMP STORE) =================
// later MongoDB me dal sakte ho
let supportInfo = {
  phone: "+91 98765 43210",
  email: "support@betogether.com",
  time: "Mon–Sat, 10 AM – 7 PM",
};

// ================= UPDATE MOBILE =================
exports.updateMobile = async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({ message: "Mobile is required" });
    }

    await Admin.findByIdAndUpdate(adminId, { mobile });

    res.json({
      isSuccess: true,
      message: "Mobile number updated successfully",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

exports.updatePassword = async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { oldPassword, newPassword } = req.body;

    // ================= VALIDATIONS =================
    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        isSuccess: false,
        message: "Old password and new password are required",
      });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({
        isSuccess: false,
        message: "New password must be different from old password",
      });
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        isSuccess: false,
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character",
      });
    }

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        isSuccess: false,
        message: "Admin not found",
      });
    }

    // ================= PASSWORD MATCH =================
    const isMatch = await bcrypt.compare(
      oldPassword,
      admin.hashed_password
    );

    if (!isMatch) {
      return res.status(400).json({
        isSuccess: false,
        message: "Old password is incorrect",
      });
    }

    // ================= UPDATE PASSWORD =================
    const salt = await bcrypt.genSalt(10);
    admin.hashed_password = await bcrypt.hash(newPassword, salt);
    await admin.save();

    return res.json({
      isSuccess: true,
      message: "Password updated successfully",
    });
  } catch (err) {
    console.error("❌ updatePassword error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
};

// ================= SEND EMAIL OTP =================
exports.sendEmailOtp = async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    await Admin.findByIdAndUpdate(adminId, {
      otp_code: otp,
      otp_expiry: new Date(Date.now() + 5 * 60 * 1000),
      temp_email: email,
    });

    await sendOtpEmail(email, otp);

    res.json({
      isSuccess: true,
      message: "OTP sent to email",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ================= VERIFY EMAIL OTP =================
exports.verifyEmailOtp = async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { otp } = req.body;

    const admin = await Admin.findById(adminId);

    if (
      !admin ||
      admin.otp_code != otp ||
      admin.otp_expiry < new Date()
    ) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    admin.email = admin.temp_email;
    admin.temp_email = null;
    admin.otp_code = null;
    admin.otp_expiry = null;
    await admin.save();

    res.json({
      isSuccess: true,
      message: "Email updated successfully",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.getProfile = async (req, res) => {
  console.log("📄 getProfile CONTROLLER START");

  try {
    console.log("🧠 req.admin:", req.admin);

    const adminId = req.admin.id;
    console.log("🆔 Admin ID from token:", adminId);

    const admin = await Admin.findById(adminId).select(
      "name email mobile supportPhone supportEmail supportTime"
    );

    console.log("👤 Admin data from DB:", admin);

    if (!admin) {
      console.log("❌ Admin not found in controller");
      return res.status(404).json({
        isSuccess: false,
        message: "Admin not found",
      });
    }

    console.log("✅ Sending admin profile response");

    return res.json({
      isSuccess: true,
      data: admin,
    });
  } catch (err) {
    console.error("❌ getProfile ERROR:", err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
};


// ================= GET SUPPORT INFO =================
exports.getSupportInfo = async (req, res) => {
  res.json({
    isSuccess: true,
    data: supportInfo,
  });
};

// ================= UPDATE SUPPORT INFO =================
exports.updateSupportInfo = async (req, res) => {
  const { phone, email, time } = req.body;

  supportInfo = { phone, email, time };

  res.json({
    isSuccess: true,
    message: "Support info updated successfully",
  });
};
