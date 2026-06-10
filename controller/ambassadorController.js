const User = require("../model/User");
const AmbassadorApplication = require("../model/AmbassadorApplication");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { sendOtpEmail, sendCredentialsEmail } = require("../utils/email");
function generateTempPassword(length = 8) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let password = "";

  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return password;
}
// =====================================
// USER APPLY FOR AMBASSADOR
// =====================================

exports.applyForAmbassador = async (req, res) => {
  try {
    const userId = req.user.id;

    const { city, country, motivation, experience, acceptedAgreement } =
      req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    if (user.isAmbassador) {
      return res.status(400).json({
        isSuccess: false,
        message: "User is already an ambassador",
      });
    }

    const existingApplication = await AmbassadorApplication.findOne({
      user: userId,
      status: "pending",
    });

    if (existingApplication) {
      return res.status(400).json({
        isSuccess: false,
        message: "Application already submitted",
      });
    }

    if (!acceptedAgreement) {
      return res.status(400).json({
        isSuccess: false,
        message: "You must accept the Ambassador Agreement",
      });
    }
    user.ambassadorAgreementAccepted = true;
    user.ambassadorAgreementAcceptedAt = new Date();

    await user.save();

    const application = await AmbassadorApplication.create({
      user: userId,
      city,
      country,
      motivation,
      experience,
      acceptedAgreement,
    });

    return res.status(201).json({
      isSuccess: true,
      message: "Ambassador application submitted successfully",
      application,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// GET MY APPLICATION
// =====================================

exports.getMyApplication = async (req, res) => {
  try {
    const userId = req.user.id;

    const application = await AmbassadorApplication.findOne({
      user: userId,
    }).sort({
      created_at: -1,
    });

    return res.json({
      isSuccess: true,
      application,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// ADMIN APPROVE APPLICATION
// =====================================

exports.approveApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;

    const application = await AmbassadorApplication.findById(applicationId);

    if (!application) {
      return res.status(404).json({
        isSuccess: false,
        message: "Application not found",
      });
    }

    const user = await User.findById(application.user);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }
    if (user.isAmbassador) {
      return res.status(400).json({
        isSuccess: false,
        message: "User is already ambassador",
      });
    }

    user.isAmbassador = true;

    user.ambassadorStatus = "approved";

    user.ambassadorApprovedAt = new Date();

    user.ambassadorApprovedBy = req.admin.id;
    user.ambassadorReviewDueAt = new Date(
      Date.now() + 180 * 24 * 60 * 60 * 1000,
    );

    if (!user.ambassadorCode) {
      user.ambassadorCode = `AMB${Date.now()}`;
    }

    await user.save();

    application.status = "approved";

    application.reviewedBy = req.admin.id;

    application.reviewedAt = new Date();

    await application.save();

    return res.json({
      isSuccess: true,
      message: "Ambassador approved successfully",
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// ADMIN REJECT APPLICATION
// =====================================

exports.rejectApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;

    const { reason } = req.body;

    const application = await AmbassadorApplication.findById(applicationId);

    if (!application) {
      return res.status(404).json({
        isSuccess: false,
        message: "Application not found",
      });
    }

    application.status = "rejected";

    application.reviewedBy = req.admin.id;

    application.reviewedAt = new Date();

    application.rejectionReason = reason || "Rejected by admin";

    await application.save();

    return res.json({
      isSuccess: true,
      message: "Application rejected successfully",
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// ADMIN DIRECT MAKE AMBASSADOR
// =====================================

exports.makeAmbassador = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    user.isAmbassador = true;
    user.ambassadorStatus = "approved";
    user.ambassadorApprovedAt = new Date();
    user.ambassadorApprovedBy = req.admin.id;
    user.ambassadorReviewDueAt = new Date(
      Date.now() + 180 * 24 * 60 * 60 * 1000,
    );
    if (!user.ambassadorCode) {
      user.ambassadorCode = `AMB${Date.now()}`;
    }

    await user.save();

    return res.json({
      isSuccess: true,
      message: "User promoted to Ambassador successfully",
      user: {
        _id: user._id,
        isAmbassador: user.isAmbassador,
        ambassadorStatus: user.ambassadorStatus,
        ambassadorCode: user.ambassadorCode,
        ambassadorApprovedAt: user.ambassadorApprovedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
// =====================================
// ADMIN GET ALL APPLICATIONS
// =====================================

exports.getAllApplications = async (req, res) => {
  try {
    const applications = await AmbassadorApplication.find()
      .populate("user", "name email mobile profile_image city country")
      .populate("reviewedBy", "name email")
      .sort({
        created_at: -1,
      });

    return res.json({
      isSuccess: true,
      count: applications.length,
      applications,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// ADMIN GET ALL AMBASSADORS
// =====================================

exports.getAllAmbassadors = async (req, res) => {
  try {
    const ambassadors = await User.find({
      isAmbassador: true,
    })
      .select(
        `
          name
          email
          mobile
          profile_image
          city
          country
          ambassadorCode
          ambassadorStatus
          ambassadorApprovedAt
          ambassadorReviewDueAt
          created_at
        `,
      )
      .sort({
        ambassadorApprovedAt: -1,
      });

    return res.json({
      isSuccess: true,
      count: ambassadors.length,
      ambassadors,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// ADMIN REMOVE AMBASSADOR
// =====================================

exports.removeAmbassador = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    user.isAmbassador = false;
    user.ambassadorStatus = "disabled";
    user.ambassadorApprovedAt = null;
    user.ambassadorApprovedBy = null;
    user.ambassadorReviewDueAt = null;
    await user.save();

    return res.json({
      isSuccess: true,
      message: "Ambassador removed successfully",
      user: {
        _id: user._id,
        isAmbassador: false,
        ambassadorStatus: "disabled",
        ambassadorCode: user.ambassadorCode,
      },
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
//ambassador create a new user under them (for referral or other purposes)
exports.createUserByAmbassador = async (req, res) => {
  try {
    const ambassadorId = req.user.id;

    const { name, email, mobile } = req.body;

    if (!name || !email || !mobile) {
      return res.status(400).json({
        isSuccess: false,
        message: "Name, email and mobile are required",
      });
    }

    const ambassador = await User.findById(ambassadorId);

    if (!ambassador) {
      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    // Only approved ambassadors
    if (
      !ambassador.isAmbassador ||
      ambassador.ambassadorStatus !== "approved"
    ) {
      return res.status(403).json({
        isSuccess: false,
        message: "Only approved ambassadors can create users",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Ambassador cannot register himself
    if (
      ambassador.email &&
      ambassador.email.toLowerCase().trim() === normalizedEmail
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: "You cannot register yourself as a user",
      });
    }

    let user = await User.findOne({
      email: normalizedEmail,
    });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    if (user) {
      // Strong check
      if (user.otp_verified || user.is_active || user.hashed_password) {
        return res.status(400).json({
          isSuccess: false,
          message: "User already exists with this email",
        });
      }

      // Another ambassador already started registration
      if (
        user.registeredByAmbassador &&
        String(user.registeredByAmbassador) !== String(ambassador._id)
      ) {
        return res.status(400).json({
          isSuccess: false,
          message: "User registration already started by another ambassador",
        });
      }

      // OTP resend cooldown
      if (
        user.lastResendAt &&
        Date.now() - new Date(user.lastResendAt).getTime() < 60 * 1000
      ) {
        return res.status(429).json({
          isSuccess: false,
          message: "Please wait 60 seconds before requesting a new OTP",
        });
      }

      user.name = name;
      user.mobile = mobile;

      user.otp_code = otp;
      user.otp_expiry = otpExpiry;
      user.lastResendAt = new Date();

      await user.save();

      await sendOtpEmail(user.email, otp);

      return res.status(200).json({
        isSuccess: true,
        message: "OTP resent successfully",
        userId: user._id,
      });
    }

    user = await User.create({
      name,
      email: normalizedEmail,
      mobile,

      register_type: "manual",
      login_type: "manual",

      registeredByAmbassador: ambassador._id,
      registeredByAmbassadorAt: new Date(),

      otp_code: otp,
      otp_expiry: otpExpiry,
      otp_verified: false,

      mustResetPassword: true,

      ambassadorUserAgreementAccepted: false,
      termsAccepted: false,
      privacyAccepted: false,

      is_active: false,
      status: "inactive",

      lastResendAt: new Date(),
    });

    await sendOtpEmail(user.email, otp);

    return res.status(201).json({
      isSuccess: true,
      message: "OTP sent successfully",
      userId: user._id,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

exports.verifyUserOtpByAmbassador = async (req, res) => {
  try {
    const ambassadorId = req.user.id;

    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        isSuccess: false,
        message: "userId and otp are required",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // Only creator ambassador can verify
    if (
      !user.registeredByAmbassador ||
      String(user.registeredByAmbassador) !== String(ambassadorId)
    ) {
      return res.status(403).json({
        isSuccess: false,
        message: "You are not allowed to verify this user",
      });
    }

    // Already activated
    if (user.otp_verified && user.is_active) {
      return res.status(400).json({
        isSuccess: false,
        message: "User already verified",
      });
    }

    // OTP expired
    if (!user.otp_expiry || user.otp_expiry < new Date()) {
      return res.status(400).json({
        isSuccess: false,
        message: "OTP expired",
      });
    }

    // Wrong OTP
    if (String(user.otp_code) !== String(otp).trim()) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid OTP",
      });
    }

    const tempPassword = generateTempPassword();

    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    user.otp_verified = true;

    user.otp_code = null;
    user.otp_expiry = null;

    user.hashed_password = hashedPassword;

    // Force manual login
    user.register_type = "manual";
    user.login_type = "manual";
    user.is_google_auth = false;

    user.is_active = true;
    user.status = "active";

    user.mustResetPassword = true;

    await user.save();

    await sendCredentialsEmail(user.email, user.email, tempPassword);

    return res.status(200).json({
      isSuccess: true,
      message: "OTP verified successfully. Login credentials sent to email.",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("verifyUserOtpByAmbassador error:", err);

    return res.status(500).json({
      isSuccess: false,
      message: "Internal server error",
    });
  }
};
