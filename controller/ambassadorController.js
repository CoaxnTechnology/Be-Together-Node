const User = require("../model/User");
const AmbassadorApplication = require("../model/AmbassadorApplication");
const Service = require("../model/Service");
const Booking = require("../model/Booking");
const bcrypt = require("bcryptjs");
const Territory = require("../model/Territory");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");
const AmbassadorWallet = require("../model/AmbassadorWallet");
const { sendOtpEmail, sendCredentialsEmail } = require("../utils/email");
const {
  sendAmbassadorApprovedNotification,
  sendAmbassadorRemovedNotification,
  sendAmbassadorRejectedNotification,
} = require("./notificationController");
const AmbassadorWalletHistory = require("../model/AmbassadorWalletHistory");
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

    const {
      name,
      email,
      phoneNumber,
      city,
      profession,
      targetAudience,
      whyBecomeAmbassador,
      howPromoteBetogether,
      socialMediaUrls = [],
      acceptedAgreement,
    } = req.body;

    // ==========================
    // Required Fields Validation
    // ==========================
    if (!name || !email || !phoneNumber || !city) {
      return res.status(400).json({
        isSuccess: false,
        message: "Name, email, phone number and city are required",
      });
    }

    if (!acceptedAgreement) {
      return res.status(400).json({
        isSuccess: false,
        message: "You must accept the Ambassador Agreement before applying",
      });
    }

    // ==========================
    // User Check
    // ==========================
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // Already Ambassador
    if (user.isAmbassador) {
      return res.status(400).json({
        isSuccess: false,
        message: "User is already an ambassador",
      });
    }

    // ==========================
    // Pending Application Check
    // ==========================
    const existingApplication = await AmbassadorApplication.findOne({
      user: userId,
      status: "pending",
    });

    if (existingApplication) {
      return res.status(400).json({
        isSuccess: false,
        message: "You already have a pending ambassador application",
      });
    }
    const lastRejectedApplication = await AmbassadorApplication.findOne({
      user: userId,
      status: "rejected",
    }).sort({ created_at: -1 });

    if (
      lastRejectedApplication &&
      lastRejectedApplication.rejectionCooldownUntil &&
      new Date() < lastRejectedApplication.rejectionCooldownUntil
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: `You can reapply after ${lastRejectedApplication.rejectionCooldownUntil.toDateString()}`,
      });
    }

    // ==========================
    // Save Agreement Acceptance
    // ==========================
    user.ambassadorAgreementAccepted = true;
    user.ambassadorAgreementAcceptedAt = new Date();

    await user.save();

    // ==========================
    // Create Application
    // ==========================
    const application = await AmbassadorApplication.create({
      user: userId,

      // Required
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phoneNumber: phoneNumber.trim(),
      city: city.trim(),

      // Optional
      profession: profession || null,
      targetAudience: targetAudience || null,

      whyBecomeAmbassador: whyBecomeAmbassador || null,

      howPromoteBetogether: howPromoteBetogether || null,

      socialMediaUrls: Array.isArray(socialMediaUrls) ? socialMediaUrls : [],

      acceptedAgreement: true,

      status: "pending",
    });

    return res.status(201).json({
      isSuccess: true,
      message: "Ambassador application submitted successfully",
      application,
    });
  } catch (err) {
    console.error("applyForAmbassador Error:", err);

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

    const { ambassadorType, territoryId, parentAmbassadorId, commissionRate } =
      req.body;
    const application = await AmbassadorApplication.findById(applicationId);

    if (!application) {
      return res.status(404).json({
        isSuccess: false,
        message: "Application not found",
      });
    }
    if (application.status !== "pending") {
      return res.status(400).json({
        isSuccess: false,
        message: "Application already processed",
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

    if (!["standard", "exclusive"].includes(ambassadorType)) {
      return res.status(400).json({
        isSuccess: false,
        message: "ambassadorType must be standard or exclusive",
      });
    }
    if (
      commissionRate === undefined ||
      commissionRate === null ||
      isNaN(commissionRate)
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate is required",
      });
    }

    if (Number(commissionRate) < 0 || Number(commissionRate) > 12) {
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate must be between 0 and 12",
      });
    }

    // =====================================
    // COMMON AMBASSADOR SETTINGS
    // =====================================

    user.isAmbassador = true;

    user.ambassadorStatus = "approved";

    user.ambassadorApprovedAt = new Date();

    user.ambassadorApprovedBy = req.admin.id;

    user.ambassadorReviewDueAt = new Date(
      Date.now() + 180 * 24 * 60 * 60 * 1000,
    );

    user.ambassadorType = ambassadorType;

    user.commissionRate = Number(commissionRate);

    user.completedPaidServices = 0;

    if (!user.ambassadorCode) {
      user.ambassadorCode = `AMB${Date.now()}`;
    }

    // =====================================
    // STANDARD AMBASSADOR
    // =====================================

    if (ambassadorType === "standard") {
      user.territory = null;
      if (parentAmbassadorId) {
        const parent = await User.findById(parentAmbassadorId);

        if (!parent) {
          return res.status(404).json({
            isSuccess: false,
            message: "Parent ambassador not found",
          });
        }

        if (!parent.isAmbassador || parent.ambassadorStatus !== "approved") {
          return res.status(400).json({
            isSuccess: false,
            message: "Parent ambassador is not active",
          });
        }
        if (parent.ambassadorType !== "exclusive") {
          return res.status(400).json({
            isSuccess: false,
            message: "Parent ambassador must be an exclusive ambassador",
          });
        }
        user.parentAmbassador = parent._id;
      }
    }

    // =====================================
    // EXCLUSIVE AMBASSADOR
    // =====================================

    if (ambassadorType === "exclusive") {
      user.parentAmbassador = null;
      if (!territoryId) {
        return res.status(400).json({
          isSuccess: false,
          message: "territoryId is required for exclusive ambassador",
        });
      }

      const territory = await Territory.findById(territoryId);

      if (!territory) {
        return res.status(404).json({
          isSuccess: false,
          message: "Territory not found",
        });
      }

      if (territory.exclusiveAmbassador) {
        return res.status(400).json({
          isSuccess: false,
          message: "Territory already assigned to another ambassador",
        });
      }

      territory.exclusiveAmbassador = user._id;

      territory.assignedAt = new Date();

      territory.reviewDueAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

      await territory.save();

      user.territory = territory._id;
    }

    await user.save();

    // =====================================
    // CREATE WALLET
    // =====================================

    const existingWallet = await AmbassadorWallet.findOne({
      ambassador: user._id,
    });

    if (!existingWallet) {
      await AmbassadorWallet.create({
        ambassador: user._id,
      });
    }

    // =====================================
    // UPDATE APPLICATION
    // =====================================

    application.status = "approved";

    application.reviewedBy = req.admin.id;

    application.reviewedAt = new Date();

    await application.save();

    // =====================================
    // NOTIFICATION
    // =====================================

    await sendAmbassadorApprovedNotification(user);

    return res.json({
      isSuccess: true,
      message: "Ambassador approved successfully",
      user: {
        _id: user._id,
        name: user.name,
        ambassadorType: user.ambassadorType,
        commissionRate: user.commissionRate,
        ambassadorCode: user.ambassadorCode,
        territory: user.territory,
        parentAmbassador: user.parentAmbassador,
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

    if (application.status !== "pending") {
      return res.status(400).json({
        isSuccess: false,
        message: "Application already processed",
      });
    }

    application.status = "rejected";

    application.reviewedBy = req.admin.id;

    application.reviewedAt = new Date();

    application.rejectionReason = reason || "Rejected by admin";
    application.rejectionCooldownUntil = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    );

    await application.save();

    // Reset ambassador agreement acceptance
    await User.findByIdAndUpdate(application.user, {
      ambassadorAgreementAccepted: false,
      ambassadorAgreementAcceptedAt: null,
    });
    const user = await User.findById(application.user);

    if (user) {
      await sendAmbassadorRejectedNotification(
        user,
        application.rejectionReason,
      );
    }

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

    const { ambassadorType, territoryId, parentAmbassadorId, commissionRate } =
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
        message: "User is already ambassador",
      });
    }
    if (
      !ambassadorType ||
      !["standard", "exclusive"].includes(ambassadorType)
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: "ambassadorType must be standard or exclusive",
      });
    }
    if (
      commissionRate === undefined ||
      commissionRate === null ||
      isNaN(commissionRate)
    ) {
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate is required",
      });
    }

    if (Number(commissionRate) < 0 || Number(commissionRate) > 12) {
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate must be between 0 and 12",
      });
    }

    // =====================================
    // BASIC AMBASSADOR DATA
    // =====================================

    user.isAmbassador = true;

    user.ambassadorStatus = "approved";

    user.ambassadorApprovedAt = new Date();

    user.ambassadorApprovedBy = req.admin.id;

    user.ambassadorReviewDueAt = new Date(
      Date.now() + 180 * 24 * 60 * 60 * 1000,
    );

    user.ambassadorType = ambassadorType;

    user.commissionRate = Number(commissionRate);

    user.completedPaidServices = 0;

    if (!user.ambassadorCode) {
      user.ambassadorCode = `AMB${Date.now()}`;
    }

    // =====================================
    // STANDARD AMBASSADOR
    // =====================================

    if (ambassadorType === "standard") {
      user.territory = null;
      if (parentAmbassadorId) {
        const parent = await User.findById(parentAmbassadorId);

        if (!parent || !parent.isAmbassador) {
          return res.status(400).json({
            isSuccess: false,
            message: "Parent ambassador not found",
          });
        }
        if (parent.ambassadorType !== "exclusive") {
          return res.status(400).json({
            isSuccess: false,
            message: "Parent ambassador must be an exclusive ambassador",
          });
        }
        user.parentAmbassador = parentAmbassadorId;
      }
    }

    // =====================================
    // EXCLUSIVE AMBASSADOR
    // =====================================

    if (ambassadorType === "exclusive") {
      user.parentAmbassador = null;
      if (!territoryId) {
        return res.status(400).json({
          isSuccess: false,
          message: "territoryId is required for exclusive ambassador",
        });
      }

      const territory = await Territory.findById(territoryId);

      if (!territory) {
        return res.status(404).json({
          isSuccess: false,
          message: "Territory not found",
        });
      }

      // territory already assigned?
      if (
        territory.exclusiveAmbassador &&
        territory.exclusiveAmbassador.toString() !== user._id.toString()
      ) {
        return res.status(400).json({
          isSuccess: false,
          message: "Territory already assigned to another ambassador",
        });
      }

      territory.exclusiveAmbassador = user._id;

      territory.assignedAt = new Date();

      territory.reviewDueAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

      await territory.save();

      user.territory = territory._id;
    }

    await user.save();

    // =====================================
    // CREATE WALLET
    // =====================================

    const existingWallet = await AmbassadorWallet.findOne({
      ambassador: user._id,
    });

    if (!existingWallet) {
      await AmbassadorWallet.create({
        ambassador: user._id,
      });
    }

    // =====================================
    // NOTIFICATION
    // =====================================

    await sendAmbassadorApprovedNotification(user);

    return res.json({
      isSuccess: true,
      message: "User promoted to Ambassador successfully",
      user: {
        _id: user._id,
        name: user.name,

        ambassadorType: user.ambassadorType,

        commissionRate: user.commissionRate,

        ambassadorCode: user.ambassadorCode,

        ambassadorStatus: user.ambassadorStatus,

        territory: user.territory,

        parentAmbassador: user.parentAmbassador,
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
      .populate({
        path: "user",
        select: `
          name
          email
          mobile
          profile_image
          city
          country
          bio
          created_at
          totalBookings
          successfulBookings
          services
          isAmbassador
          ambassadorStatus
        `,
      })
      .populate("reviewedBy", "name email")
      .sort({
        created_at: -1,
      });

    const formattedApplications = applications.map((app) => ({
      _id: app._id,
      city: app.city,
      // Application Details
      status: app.status,
      acceptedAgreement: app.acceptedAgreement,

      profession: app.profession,
      targetAudience: app.targetAudience,

      whyBecomeAmbassador: app.whyBecomeAmbassador,

      howPromoteBetogether: app.howPromoteBetogether,

      socialMediaUrls: app.socialMediaUrls || [],

      rejectionReason: app.rejectionReason,

      reviewedAt: app.reviewedAt,

      created_at: app.created_at,

      updated_at: app.updated_at,

      // User Profile
      user: app.user
        ? {
            _id: app.user._id,

            name: app.user.name,

            email: app.user.email,

            mobile: app.user.mobile,

            profile_image: app.user.profile_image,

            city: app.user.city,

            country: app.user.country,

            bio: app.user.bio,

            joinedAt: app.user.created_at,

            totalBookings: app.user.totalBookings || 0,

            successfulBookings: app.user.successfulBookings || 0,

            totalServices: Array.isArray(app.user.services)
              ? app.user.services.length
              : 0,

            ambassadorStatus: app.user.ambassadorStatus,
          }
        : null,

      reviewedBy: app.reviewedBy
        ? {
            _id: app.reviewedBy._id,
            name: app.reviewedBy.name,
            email: app.reviewedBy.email,
          }
        : null,
    }));

    return res.status(200).json({
      isSuccess: true,
      count: formattedApplications.length,
      applications: formattedApplications,
    });
  } catch (err) {
    console.error("getAllApplications Error:", err);

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
        ambassadorType
        commissionRate
        completedPaidServices
        territory
        parentAmbassador
        created_at
      `,
      )
      .populate(
        "territory",
        `
          city
          country
          active
          kpiTarget
        `,
      )
      .populate(
        "parentAmbassador",
        `
          name
          email
          ambassadorCode
        `,
      )
      .sort({
        ambassadorApprovedAt: -1,
      });

    const ambassadorIds = ambassadors.map((ambassador) => ambassador._id);

    const wallets = await AmbassadorWallet.find({
      ambassador: {
        $in: ambassadorIds,
      },
    });

    const walletMap = {};

    wallets.forEach((wallet) => {
      walletMap[wallet.ambassador.toString()] = wallet;
    });

    const formattedAmbassadors = await Promise.all(
      ambassadors.map(async (ambassador) => {
        const wallet = walletMap[ambassador._id.toString()];

        const subAmbassadorCount = await User.countDocuments({
          parentAmbassador: ambassador._id,
        });

        return {
          _id: ambassador._id,

          name: ambassador.name,
          email: ambassador.email,
          mobile: ambassador.mobile,
          profile_image: ambassador.profile_image,

          city: ambassador.city,
          country: ambassador.country,

          ambassadorCode: ambassador.ambassadorCode,

          ambassadorStatus: ambassador.ambassadorStatus,

          ambassadorType: ambassador.ambassadorType,

          commissionRate: ambassador.commissionRate || 0,

          completedPaidServices: ambassador.completedPaidServices || 0,

          ambassadorApprovedAt: ambassador.ambassadorApprovedAt,

          ambassadorReviewDueAt: ambassador.ambassadorReviewDueAt,

          created_at: ambassador.created_at,

          territory: ambassador.territory || null,

          parentAmbassador: ambassador.parentAmbassador || null,

          wallet: {
            balance: wallet?.balance || 0,

            totalEarned: wallet?.totalEarned || 0,

            totalWithdrawn: wallet?.totalWithdrawn || 0,
          },

          subAmbassadorCount,
        };
      }),
    );

    return res.status(200).json({
      isSuccess: true,

      count: formattedAmbassadors.length,

      ambassadors: formattedAmbassadors,
    });
  } catch (err) {
    console.error("getAllAmbassadors error:", err);

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

    // =====================================
    // CHECK SUB AMBASSADORS
    // =====================================

    const subAmbassadorCount = await User.countDocuments({
      parentAmbassador: user._id,
      isAmbassador: true,
    });

    if (subAmbassadorCount > 0) {
      return res.status(400).json({
        isSuccess: false,
        message: `Cannot remove ambassador. ${subAmbassadorCount} active sub ambassadors are still assigned.`,
      });
    }

    // =====================================
    // TERRITORY CLEANUP
    // =====================================

    if (user.territory) {
      await Territory.findByIdAndUpdate(user.territory, {
        $set: {
          exclusiveAmbassador: null,
        },
      });
    }

    // =====================================
    // DISABLE AMBASSADOR
    // =====================================

    user.isAmbassador = false;

    user.ambassadorStatus = "disabled";

    user.ambassadorType = null;

    user.parentAmbassador = null;

    user.territory = null;

    user.commissionRate = 0;

    user.completedPaidServices = 0;

    user.ambassadorApprovedAt = null;

    user.ambassadorApprovedBy = null;

    user.ambassadorReviewDueAt = null;

    // Historical data preserve karo
    // user.totalReferralUsers
    // user.totalReferralEarned
    // user.ambassadorCode

    await user.save();

    // =====================================
    // SEND NOTIFICATION
    // =====================================

    await sendAmbassadorRemovedNotification(user);

    return res.status(200).json({
      isSuccess: true,
      message: "Ambassador removed successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,

        isAmbassador: false,
        ambassadorStatus: "disabled",

        ambassadorCode: user.ambassadorCode,
      },
    });
  } catch (err) {
    console.error("removeAmbassador Error:", err);

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

    // Already verified
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

    // Generate reset password token
    const resetToken = crypto.randomBytes(32).toString("hex");

    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Activate user
    user.otp_verified = true;

    user.otp_code = null;
    user.otp_expiry = null;

    // Force manual login only
    user.register_type = "manual";
    user.login_type = "manual";
    user.is_google_auth = false;

    user.is_active = true;
    user.status = "active";

    // Password not created yet
    user.hashed_password = null;
    user.passwordChangedByUser = false;

    // Reset password setup flow
    user.reset_password_token = hashedToken;
    user.reset_password_expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.passwordChangedByUser = false;

    await user.save();

    // Send welcome email with reset link
    await sendCredentialsEmail(user.email, user.email, resetToken);

    return res.status(200).json({
      isSuccess: true,
      message: "OTP verified successfully. Password setup link sent to email.",
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
      message: err.message,
    });
  }
};

exports.getMyWallet = async (req, res) => {
  try {
    const ambassadorId = req.user.id;

    let wallet = await AmbassadorWallet.findOne({
      ambassador: ambassadorId,
    });

    if (!wallet) {
      wallet = await AmbassadorWallet.create({
        ambassador: ambassadorId,
      });
    }

    const history = await AmbassadorWalletHistory.find({
      ambassador: ambassadorId,
    })
      .populate("service", "title")
      .sort({ createdAt: -1 })
      .limit(20);

    return res.status(200).json({
      isSuccess: true,

      wallet: {
        balance: wallet.balance,
        totalEarned: wallet.totalEarned,
        totalWithdrawn: wallet.totalWithdrawn,
      },

      history,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
exports.assignParentAmbassador = async (req, res) => {
  try {
    const { userId } = req.params;

    const { parentAmbassadorId } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    const parent = await User.findById(parentAmbassadorId);

    if (!parent) {
      return res.status(404).json({
        isSuccess: false,
        message: "Parent ambassador not found",
      });
    }
    if (String(user._id) === String(parent._id)) {
      return res.status(400).json({
        isSuccess: false,
        message: "Ambassador cannot be parent of himself",
      });
    }
    if (user.ambassadorType !== "standard") {
      return res.status(400).json({
        isSuccess: false,
        message: "Only standard ambassadors can have parent ambassadors",
      });
    }
    if (!parent.isAmbassador || parent.ambassadorType !== "exclusive") {
      return res.status(400).json({
        isSuccess: false,
        message: "Parent must be an exclusive ambassador",
      });
    }

    user.parentAmbassador = parent._id;

    await user.save();

    return res.json({
      isSuccess: true,
      message: "Parent ambassador assigned successfully",
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
exports.dashboard = async (req, res) => {
  try {
    const ambassadorId = req.user.id;

    const ambassadorObjectId = new mongoose.Types.ObjectId(ambassadorId);

    const ambassador = await User.findById(ambassadorId).populate("territory");
    const ambassadorInfo = {
      id: ambassador._id,
      name: ambassador.name,
      email: ambassador.email,
      profile_image: ambassador.profile_image,
      ambassadorType: ambassador.ambassadorType,
      commissionRate: ambassador.commissionRate,
    };

    if (!ambassador) {
      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    // =====================================
    // WALLET
    // =====================================

    const wallet = await AmbassadorWallet.findOne({
      ambassador: ambassadorId,
    });

    const walletData = {
      balance: wallet?.balance || 0,
      totalEarned: wallet?.totalEarned || 0,
      totalWithdrawn: wallet?.totalWithdrawn || 0,

      pendingWithdrawal: 0,
    };

    // =====================================
    // REFERRALS
    // =====================================

    const referredUsers = await User.find({
      referredBy: ambassadorId,
    }).select("_id");

    const referredUserIds = referredUsers.map((user) => user._id);

    const totalReferralUsers = referredUserIds.length;
    const recentReferrals = await User.find({
      referredBy: ambassadorId,
    })
      .select(
        "name email profile_image city country created_at successfulBookings",
      )
      .sort({
        created_at: -1,
      })
      .limit(10);

    // =====================================
    // SERVICES CREATED BY REFERRALS
    // =====================================

    const totalServices = await Service.countDocuments({
      owner: {
        $in: referredUserIds,
      },
    });

    // =====================================
    // COMPLETED BOOKINGS
    // =====================================

    const totalCompletedBookings = await Booking.countDocuments({
      status: "completed",

      $or: [
        {
          customer: {
            $in: referredUserIds,
          },
        },
        {
          provider: {
            $in: referredUserIds,
          },
        },
      ],
    });

    // =====================================
    // COMMISSION BREAKDOWN
    // =====================================

    const customerSide = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          commissionSource: "customer_side",
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: "$amount",
          },
        },
      },
    ]);

    const providerSide = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          commissionSource: "provider_side",
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: "$amount",
          },
        },
      },
    ]);

    const territorial = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          commissionSource: "territorial",
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: "$amount",
          },
        },
      },
    ]);

    const customerCommission = customerSide[0]?.total || 0;

    const providerCommission = providerSide[0]?.total || 0;

    const territorialCommission = territorial[0]?.total || 0;

    const totalCommission =
      customerCommission + providerCommission + territorialCommission;
    const earningsChart = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          type: "commission_earned",
        },
      },
      {
        $group: {
          _id: {
            year: {
              $year: "$createdAt",
            },
            month: {
              $month: "$createdAt",
            },
          },

          total: {
            $sum: "$amount",
          },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
    ]);
    const formattedEarningsChart = earningsChart.map((item) => ({
      month: `${item._id.month}-${item._id.year}`,
      total: item.total,
    }));
    const recentCommissions = await AmbassadorWalletHistory.find({
      ambassador: ambassadorId,
      type: "commission_earned",
    })
      .select(
        "amount commissionSource commissionRate createdAt referredUser service",
      )
      .populate("service", "title city price")
      .populate("referredUser", "name email")
      .sort({
        createdAt: -1,
      })
      .limit(10);
    // =====================================
    // EXCLUSIVE AMBASSADOR DATA
    // =====================================

    let exclusiveData = null;

    if (ambassador.ambassadorType === "exclusive") {
      const territory = ambassador.territory;

      if (territory) {
        const territoryServices = await Service.find({
          city: territory.city,
        }).select("_id");

        const territoryServiceIds = territoryServices.map(
          (service) => service._id,
        );

        const territoryBookings = await Booking.countDocuments({
          status: "completed",
          service: {
            $in: territoryServiceIds,
          },
        });

        const territoryRevenue = await Booking.aggregate([
          {
            $match: {
              status: "completed",
              service: {
                $in: territoryServiceIds,
              },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: "$amount",
              },
            },
          },
        ]);
        const territoryProviders = await Service.distinct("owner", {
          city: territory.city,
        });

        const totalProviders = territoryProviders.length;

        const territoryCustomers = await Booking.distinct("customer", {
          status: "completed",
          service: {
            $in: territoryServiceIds,
          },
        });
        // KPI
        const sixMonthsAgo = new Date();

        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const kpiBookings = await Booking.countDocuments({
          status: "completed",

          createdAt: {
            $gte: sixMonthsAgo,
          },

          service: {
            $in: territoryServiceIds,
          },
        });

        const subAmbassadorCount = await User.countDocuments({
          parentAmbassador: ambassadorId,
        });

        const subAmbassadorList = await User.find({
          parentAmbassador: ambassadorId,
        })
          .select("name email city country totalReferralEarned")
          .limit(20);

        exclusiveData = {
          territory: {
            id: territory._id,
            city: territory.city,
            country: territory.country,
          },

          stats: {
            services: territoryServiceIds.length,

            bookings: territoryBookings,

            revenue: territoryRevenue[0]?.totalRevenue || 0,

            providers: totalProviders,

            customers: territoryCustomers.length,

            territorialCommission,
          },

          kpi: {
            target: 400,

            completed: kpiBookings,
            progressPercentage: Number(((kpiBookings / 400) * 100).toFixed(2)),
            remaining: Math.max(0, 400 - kpiBookings),

            achieved: kpiBookings >= 400,
          },

          subAmbassadors: {
            count: subAmbassadorCount,
            list: subAmbassadorList,
          },
        };
      }
    }

    return res.json({
      isSuccess: true,

      dashboard: {
        ambassador: ambassadorInfo,
        ambassadorType: ambassador.ambassadorType,

        territory: ambassador?.territory
          ? {
              id: ambassador.territory._id,
              city: ambassador.territory.city,
            }
          : null,

        wallet: walletData,

        referrals: {
          totalUsers: totalReferralUsers,

          recent: recentReferrals,
        },

        services: {
          created: totalServices,
        },

        bookings: {
          completed: totalCompletedBookings,
        },

        commission: {
          total: totalCommission,

          customerSide: customerCommission,

          providerSide: providerCommission,

          territorial: territorialCommission,
        },
        earningsChart: formattedEarningsChart,

        recentCommissions,
        exclusiveData,
      },
    });
  } catch (error) {
    console.error("Ambassador dashboard error:", error);

    return res.status(500).json({
      isSuccess: false,
      message: error.message,
    });
  }
};
exports.walletHistory = async (req, res) => {
  try {
    const ambassadorId = req.user.id;

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    const skip = (page - 1) * limit;

    const total = await AmbassadorWalletHistory.countDocuments({
      ambassador: ambassadorId,
    });

    const history = await AmbassadorWalletHistory.find({
      ambassador: ambassadorId,
    })
      .populate("booking", "_id amount status createdAt")
      .populate("service", "title city")
      .populate("referredUser", "name email")
      .populate("territory", "city country")
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit);

    return res.json({
      isSuccess: true,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },

      history,
    });
  } catch (error) {
    console.error("walletHistory error:", error);

    return res.status(500).json({
      isSuccess: false,
      message: error.message,
    });
  }
};
exports.getAmbassadorById = async (req, res) => {
  try {
    const { id } = req.params;

    const ambassador = await User.findById(id)
      .populate("territory")
      .populate("parentAmbassador", "name email ambassadorCode");

    if (!ambassador) {
      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    const wallet = await AmbassadorWallet.findOne({
      ambassador: ambassador._id,
    });

    const subAmbassadorCount = await User.countDocuments({
      parentAmbassador: ambassador._id,
    });

    return res.status(200).json({
      isSuccess: true,

      ambassador: {
        _id: ambassador._id,
        name: ambassador.name,
        email: ambassador.email,
        mobile: ambassador.mobile,
        city: ambassador.city,
        country: ambassador.country,
        profile_image: ambassador.profile_image,

        ambassadorCode: ambassador.ambassadorCode,

        ambassadorType: ambassador.ambassadorType,

        ambassadorStatus: ambassador.ambassadorStatus,

        commissionRate: ambassador.commissionRate,

        completedPaidServices: ambassador.completedPaidServices,

        ambassadorApprovedAt: ambassador.ambassadorApprovedAt,

        ambassadorReviewDueAt: ambassador.ambassadorReviewDueAt,

        territory: ambassador.territory,

        parentAmbassador: ambassador.parentAmbassador,

        subAmbassadorCount,

        wallet: {
          balance: wallet?.balance || 0,

          totalEarned: wallet?.totalEarned || 0,

          totalWithdrawn: wallet?.totalWithdrawn || 0,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
exports.getAmbassadorWalletHistory = async (req, res) => {
  try {
    const ambassadorId = req.params.id;

    const page = Number(req.query.page || 1);

    const limit = Number(req.query.limit || 20);

    const skip = (page - 1) * limit;

    const total = await AmbassadorWalletHistory.countDocuments({
      ambassador: ambassadorId,
    });

    const history = await AmbassadorWalletHistory.find({
      ambassador: ambassadorId,
    })
      .populate("booking", "_id amount status createdAt")
      .populate("service", "title city")
      .populate("referredUser", "name email")
      .populate("territory", "city country")
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      isSuccess: true,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },

      history,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
exports.getAmbassadorAnalytics = async (req, res) => {
  try {
    const { id } = req.params;

    const ambassadorObjectId = new mongoose.Types.ObjectId(id);

    // ==========================
    // COMMISSION BREAKDOWN
    // ==========================

    const customerSide = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          commissionSource: "customer_side",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const providerSide = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          commissionSource: "provider_side",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const territorial = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          commissionSource: "territorial",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    // ==========================
    // EARNINGS CHART
    // ==========================

    const earningsChart = await AmbassadorWalletHistory.aggregate([
      {
        $match: {
          ambassador: ambassadorObjectId,
          type: "commission_earned",
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          total: {
            $sum: "$amount",
          },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
    ]);

    // ==========================
    // SUB AMBASSADORS
    // ==========================

    const subAmbassadors = await User.find({
      parentAmbassador: ambassadorObjectId,
    }).select(`
      name
      email
      ambassadorType
      commissionRate
      ambassadorCode
    `);
    // ======================================
    // REFERRAL STATS
    // ======================================

    const referredUsers = await User.find({
      referredBy: ambassadorObjectId,
    }).select("_id");

    const referredUserIds = referredUsers.map((u) => u._id);

    const totalReferralUsers = referredUserIds.length;

    const totalServices = await Service.countDocuments({
      owner: {
        $in: referredUserIds,
      },
    });

    const totalBookings = await Booking.countDocuments({
      status: "completed",
      $or: [
        {
          customer: {
            $in: referredUserIds,
          },
        },
        {
          provider: {
            $in: referredUserIds,
          },
        },
      ],
    });
    // ==========================
    // WALLET BALANCE FOR EACH
    // ==========================

    const subAmbassadorsWithWallet = await Promise.all(
      subAmbassadors.map(async (amb) => {
        const wallet = await AmbassadorWallet.findOne({
          ambassador: amb._id,
        });

        return {
          _id: amb._id,
          name: amb.name,
          email: amb.email,
          ambassadorType: amb.ambassadorType,
          ambassadorCode: amb.ambassadorCode,
          commissionRate: amb.commissionRate || 0,
          walletBalance: wallet?.balance || 0,
          totalEarned: wallet?.totalEarned || 0,
        };
      }),
    );

    const customerCommission = customerSide[0]?.total || 0;
    const providerCommission = providerSide[0]?.total || 0;
    const territorialCommission = territorial[0]?.total || 0;

    const totalCommission =
      customerCommission + providerCommission + territorialCommission;

    return res.status(200).json({
      isSuccess: true,
      analytics: {
        customerCommission,
        providerCommission,
        territorialCommission,
        totalCommission,
        earningsChart,
        totalReferralUsers,
        services: totalServices,
        bookings: totalBookings,
        subAmbassadors: subAmbassadorsWithWallet,
        subAmbassadorCount: subAmbassadorsWithWallet.length,
      },
    });
  } catch (err) {
    console.error("getAmbassadorAnalytics Error:", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
