const User = require("../model/User");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const AmbassadorApplication = require("../model/AmbassadorApplication");
const Service = require("../model/Service");
const Booking = require("../model/Booking");
const bcrypt = require("bcryptjs");
const endpointSecret = process.env.STRIPE_PAYMENT_WEBHOOK_SECRET;
const Territory = require("../model/Territory");
const fs = require("fs");
const crypto = require("crypto");
const AmbassadorWithdrawal = require("../model/AmbassadorWithdrawal");
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
      applicationType = "self",
      requestedUserId,
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

    // =====================================
    // SELF APPLICATION VALIDATION
    // =====================================

    if (applicationType === "self") {
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
    // =====================================
    // EXCLUSIVE AMBASSADOR REQUEST VALIDATION
    // =====================================

    if (applicationType === "exclusive_request") {
      if (
        !user.isAmbassador ||
        user.ambassadorStatus !== "approved" ||
        user.ambassadorType !== "exclusive"
      ) {
        return res.status(403).json({
          isSuccess: false,
          message:
            "Only approved exclusive ambassadors can create this request",
        });
      }
    }

    // Already Ambassador
    if (applicationType === "self") {
      if (user.isAmbassador) {
        return res.status(400).json({
          isSuccess: false,
          message: "User is already an ambassador",
        });
      }
    }
    // =====================================
    // EXCLUSIVE REQUEST USER CHECK
    // =====================================

    let requestedUser = null;

    if (applicationType === "exclusive_request") {
      if (!requestedUserId) {
        return res.status(400).json({
          isSuccess: false,
          message: "requestedUserId is required",
        });
      }

      requestedUser = await User.findById(requestedUserId);

      if (!requestedUser) {
        return res.status(404).json({
          isSuccess: false,
          message: "Requested user not found",
        });
      }

      if (requestedUser.isAmbassador) {
        return res.status(400).json({
          isSuccess: false,
          message: "User is already an ambassador",
        });
      }
    }
    // ==========================
    // Pending Application Check
    // ==========================
    const existingApplication = await AmbassadorApplication.findOne({
      user:
        applicationType === "exclusive_request" ? requestedUser._id : userId,

      status: "pending",

      applicationType:
        applicationType === "exclusive_request" ? "exclusive_request" : "self",
    });

    if (existingApplication) {
      return res.status(400).json({
        isSuccess: false,
        message: "You already have a pending ambassador application",
      });
    }
    const lastRejectedApplication = await AmbassadorApplication.findOne({
      user:
        applicationType === "exclusive_request" ? requestedUser._id : userId,

      status: "rejected",
    }).sort({
      created_at: -1,
    });
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
    if (applicationType === "self") {
      user.ambassadorAgreementAccepted = true;

      user.ambassadorAgreementAcceptedAt = new Date();

      await user.save();
    }
    // ==========================
    // Create Application
    // ==========================
    let application;

    // =====================================
    // SELF APPLICATION
    // =====================================

    if (applicationType === "self") {
      application = await AmbassadorApplication.create({
        applicationType: "self",

        user: userId,

        name: name.trim(),
        email: email.trim().toLowerCase(),
        phoneNumber: phoneNumber.trim(),
        city: city.trim(),

        profession: profession || null,
        targetAudience: targetAudience || null,
        whyBecomeAmbassador: whyBecomeAmbassador || null,
        howPromoteBetogether: howPromoteBetogether || null,

        socialMediaUrls: Array.isArray(socialMediaUrls) ? socialMediaUrls : [],

        acceptedAgreement: true,

        status: "pending",
      });
    }

    // =====================================
    // EXCLUSIVE REQUEST
    // =====================================
    else {
      application = await AmbassadorApplication.create({
        applicationType: "exclusive_request",

        user: requestedUser._id,

        requestedUser: requestedUser._id,

        requestedByExclusive: user._id,

        name: requestedUser.name,

        email: requestedUser.email,

        phoneNumber: requestedUser.mobile || "",

        city: requestedUser.city || "",

        acceptedAgreement: true,

        status: "pending",
      });
    }

    return res.status(201).json({
      isSuccess: true,

      message:
        applicationType === "self"
          ? "Ambassador application submitted successfully"
          : "Standard ambassador request submitted successfully",

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

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // ====================================================
    // EXCLUSIVE AMBASSADOR
    // Return all requests created by this ambassador
    // ====================================================

    if (
      user.isAmbassador &&
      user.ambassadorStatus === "approved" &&
      user.ambassadorType === "exclusive"
    ) {
      const applications = await AmbassadorApplication.find({
        applicationType: "exclusive_request",
        requestedByExclusive: userId,
      })
        .populate("requestedUser", "name email mobile city profile_image")
        .sort({
          created_at: -1,
        });

      return res.json({
        isSuccess: true,
        applicationType: "exclusive_request",
        totalRequests: applications.length,
        applications,
      });
    }

    // ====================================================
    // NORMAL USER
    // Return own ambassador application
    // ====================================================

    const application = await AmbassadorApplication.findOne({
      user: userId,
    })
      .populate(
        "requestedByExclusive",
        "name email ambassadorCode ambassadorType",
      )
      .sort({
        created_at: -1,
      });

    return res.json({
      isSuccess: true,
      applicationType: "self",
      application,
    });
  } catch (err) {
    console.error("getMyApplication Error:", err);

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
    const application = await AmbassadorApplication.findById(
      applicationId,
    ).populate({
      path: "requestedByExclusive",
      select: "_id territory isAmbassador ambassadorStatus ambassadorType",
      populate: {
        path: "territory",
      },
    });
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
    // =====================================
    // FORCE STANDARD FOR EXCLUSIVE REQUEST
    // =====================================

    let finalAmbassadorType = ambassadorType;

    if (application.applicationType === "exclusive_request") {
      finalAmbassadorType = "standard";
    }

    if (!["standard", "exclusive"].includes(finalAmbassadorType)) {
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

    user.ambassadorType = finalAmbassadorType;

    user.commissionRate = Number(commissionRate);

    user.completedPaidServices = 0;

    if (!user.ambassadorCode) {
      user.ambassadorCode = `AMB${Date.now()}`;
    }

    // =====================================
    // STANDARD AMBASSADOR
    // =====================================

    if (finalAmbassadorType === "standard") {
      user.territory = null;
      // =====================================
      // EXCLUSIVE REQUEST
      // =====================================

      if (application.applicationType === "exclusive_request") {
        const exclusive = application.requestedByExclusive;

        if (!exclusive) {
          return res.status(404).json({
            isSuccess: false,
            message: "Exclusive ambassador not found",
          });
        }
        if (
          !exclusive.isAmbassador ||
          exclusive.ambassadorStatus !== "approved" ||
          exclusive.ambassadorType !== "exclusive"
        ) {
          return res.status(400).json({
            isSuccess: false,
            message: "Exclusive ambassador is no longer active",
          });
        }

        user.parentAmbassador = exclusive._id;

        user.territory = exclusive.territory;
      } else if (parentAmbassadorId) {
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

    if (finalAmbassadorType === "exclusive") {
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
    if (application.applicationType === "self") {
      await User.findByIdAndUpdate(application.user, {
        ambassadorAgreementAccepted: false,
        ambassadorAgreementAcceptedAt: null,
      });
    }
    const user = await User.findById(application.user);

    if (user) {
      await sendAmbassadorRejectedNotification(
        user,
        application.rejectionReason,
      );
    }

    return res.json({
      isSuccess: true,
      message:
        application.applicationType === "self"
          ? "Ambassador application rejected successfully"
          : "Standard ambassador request rejected successfully",
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
      .populate(
        "requestedUser",
        `
    name
    email
    mobile
    city
    country
    bio
    profile_image
    created_at
    totalBookings
    successfulBookings
    services
    ambassadorStatus
  `,
      )
      .populate({
        path: "requestedByExclusive",
        select: "name email ambassadorCode territory",
        populate: {
          path: "territory",
          select: "city country",
        },
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
      applicationType: app.applicationType || "self",

      requestedUser:
        (app.applicationType || "self") === "exclusive_request" &&
        app.requestedUser
          ? {
              _id: app.requestedUser._id,
              name: app.requestedUser.name,
              email: app.requestedUser.email,
              mobile: app.requestedUser.mobile,
              city: app.requestedUser.city,
              country: app.requestedUser.country,
              bio: app.requestedUser.bio,
              profile_image: app.requestedUser.profile_image,
              joinedAt: app.requestedUser.created_at,
              totalBookings: app.requestedUser.totalBookings || 0,
              successfulBookings: app.requestedUser.successfulBookings || 0,
              totalServices: Array.isArray(app.requestedUser.services)
                ? app.requestedUser.services.length
                : 0,
              ambassadorStatus: app.requestedUser.ambassadorStatus,
            }
          : null,

      requestedByExclusive:
        (app.applicationType || "self") === "exclusive_request" &&
        app.requestedByExclusive
          ? {
              _id: app.requestedByExclusive._id,
              name: app.requestedByExclusive.name,
              email: app.requestedByExclusive.email,
              ambassadorCode: app.requestedByExclusive.ambassadorCode,
              territory: app.requestedByExclusive.territory
                ? {
                    _id: app.requestedByExclusive.territory._id,
                    city: app.requestedByExclusive.territory.city,
                    country: app.requestedByExclusive.territory.country,
                  }
                : null,
            }
          : null,
      acceptedAgreement:
        (app.applicationType || "self") === "self"
          ? app.acceptedAgreement
          : null,
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
      user:
        (app.applicationType || "self") === "self" && app.user
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
    if (!user.isAmbassador) {
      return res.status(400).json({
        isSuccess: false,
        message: "User is not an ambassador",
      });
    }

    // =====================================
    // CHECK SUB AMBASSADORS
    // =====================================

    const subAmbassadorCount = await User.countDocuments({
      parentAmbassador: user._id,
      isAmbassador: true,
      ambassadorStatus: "approved",
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
    user.ambassadorAgreementAccepted = false;
    user.ambassadorAgreementAcceptedAt = null;
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
      registeredAfterAmbassadorApproval: true,

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
      registeredByAmbassador: ambassadorId,
    }).select("_id");

    const referredUserIds = referredUsers.map((user) => user._id);

    const totalReferralUsers = referredUserIds.length;
    const recentReferrals = await User.find({
      registeredByAmbassador: ambassadorId,
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
      .populate({
        path: "booking",
        select: "_id amount status createdAt customer provider",
        populate: [
          {
            path: "customer",
            select: "name email profile_image",
          },
          {
            path: "provider",
            select: "name email profile_image",
          },
        ],
      })
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

    // AMBASSADOR DETAILS
    // ==========================

    const ambassador = await User.findById(id).populate("territory");

    if (!ambassador) {
      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    // ==========================
    // WALLET
    // ==========================

    const wallet = await AmbassadorWallet.findOne({
      ambassador: id,
    });
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
      registeredByAmbassador: ambassadorObjectId,
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
    // TERRITORY ANALYTICS
    // ==========================

    let territoryRevenue = 0;
    let territoryBookings = 0;
    let kpiProgress = 0;

    if (ambassador.ambassadorType === "exclusive" && ambassador.territory) {
      const territoryServices = await Service.find({
        city: ambassador.territory.city,
      }).select("_id");

      const territoryServiceIds = territoryServices.map(
        (service) => service._id,
      );

      // Total completed bookings
      territoryBookings = await Booking.countDocuments({
        status: "completed",
        service: {
          $in: territoryServiceIds,
        },
      });

      // Territory revenue
      const revenue = await Booking.aggregate([
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

      territoryRevenue = revenue[0]?.totalRevenue || 0;

      // KPI Progress
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const completedBookings = await Booking.countDocuments({
        status: "completed",
        createdAt: {
          $gte: sixMonthsAgo,
        },
        service: {
          $in: territoryServiceIds,
        },
      });

      kpiProgress = Number(((completedBookings / 400) * 100).toFixed(2));
    }
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
        // Wallet
        wallet: {
          balance: wallet?.balance || 0,
          totalEarned: wallet?.totalEarned || 0,
          totalWithdrawn: wallet?.totalWithdrawn || 0,
        },

        // Referral Stats
        referrals: totalReferralUsers,
        totalReferralUsers,

        // Service & Booking Stats
        services: totalServices,
        bookings: totalBookings,

        // Territory Stats
        territoryRevenue,
        territoryBookings,
        territoryCommission: territorialCommission,
        kpiProgress,

        // Commission
        customerCommission,
        providerCommission,
        territorialCommission,
        totalCommission,

        // Charts
        earningsChart,

        // Sub Ambassadors
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
exports.withdrawAmount = async (req, res) => {
  const session = await mongoose.startSession();

  let withdrawalDoc = null;
  const ambassadorId = req.user.id;
  let transfer = null;
  let wallet = null;
  const amount = Number(req.body.amount);

  console.log("[withdrawAmount] Start", {
    ambassadorId,
    amount,
    body: req.body,
  });

  try {
    await session.startTransaction();
    console.log("[withdrawAmount] Transaction started", { ambassadorId });

    // ======================================
    // Amount Validation
    // ======================================

    if (!amount || isNaN(amount)) {
      console.log(
        "[withdrawAmount] Amount validation failed: missing/invalid",
        {
          amount,
        },
      );
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "Amount is required",
      });
    }

    if (!Number.isFinite(amount) || !Number.isInteger(amount * 100)) {
      console.log("[withdrawAmount] Amount validation failed: invalid cents", {
        amount,
      });
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "Invalid amount",
      });
    }

    if (amount < 20) {
      console.log("[withdrawAmount] Amount validation failed: below minimum", {
        amount,
      });
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "Minimum withdrawal amount is €20",
      });
    }

    // ======================================
    // User
    // ======================================

    const user = await User.findById(ambassadorId).session(session);
    console.log("[withdrawAmount] User loaded", {
      ambassadorId,
      userId: user?._id,
      isAmbassador: user?.isAmbassador,
      ambassadorStatus: user?.ambassadorStatus,
      stripeAccountId: user?.stripeAccountId,
    });

    if (!user) {
      console.log("[withdrawAmount] User not found", { ambassadorId });
      await session.abortTransaction();

      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // ======================================
    // Ambassador Validation
    // ======================================

    if (!user.isAmbassador) {
      console.log(
        "[withdrawAmount] Ambassador validation failed: not ambassador",
        {
          ambassadorId,
        },
      );
      await session.abortTransaction();

      return res.status(403).json({
        isSuccess: false,
        message: "Only ambassadors can withdraw.",
      });
    }

    if (user.ambassadorStatus !== "approved") {
      console.log(
        "[withdrawAmount] Ambassador validation failed: status not approved",
        {
          ambassadorId,
          ambassadorStatus: user.ambassadorStatus,
        },
      );
      await session.abortTransaction();

      return res.status(403).json({
        isSuccess: false,
        message: "Ambassador is not approved.",
      });
    }

    // ======================================
    // Wallet
    // ======================================

    wallet = await AmbassadorWallet.findOne({
      ambassador: ambassadorId,
    }).session(session);
    console.log("[withdrawAmount] Wallet loaded", {
      ambassadorId,
      walletId: wallet?._id,
      availableBalance: wallet?.availableBalance,
      reservedBalance: wallet?.reservedBalance,
    });

    if (!wallet) {
      console.log("[withdrawAmount] Wallet not found", { ambassadorId });
      await session.abortTransaction();

      return res.status(404).json({
        isSuccess: false,
        message: "Wallet not found",
      });
    }

    if (wallet.availableBalance < amount) {
      console.log("[withdrawAmount] Insufficient wallet balance", {
        ambassadorId,
        availableBalance: wallet.availableBalance,
        requestedAmount: amount,
      });
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "Insufficient wallet balance",
      });
    }

    // ======================================
    // Stripe Account
    // ======================================

    if (!user.stripeAccountId) {
      console.log("[withdrawAmount] Creating Stripe account", {
        ambassadorId,
        email: user.email,
      });
      const account = await stripe.accounts.create({
        type: "express",

        country: "IT",

        email: user.email,

        capabilities: {
          transfers: {
            requested: true,
          },
        },
      });

      console.log("[withdrawAmount] Stripe account created", {
        ambassadorId,
        accountId: account.id,
      });

      user.stripeAccountId = account.id;

      user.stripeAccountCreatedAt = new Date();

      await user.save({ session });
      console.log("[withdrawAmount] User Stripe account saved", {
        ambassadorId,
        stripeAccountId: user.stripeAccountId,
      });

      const accountLink = await stripe.accountLinks.create({
        account: account.id,

        refresh_url: `${process.env.APP_URL}/withdraw`,

        return_url: `${process.env.APP_URL}/withdraw-success`,

        type: "account_onboarding",
      });

      console.log("[withdrawAmount] Stripe onboarding link created", {
        ambassadorId,
        onboardingUrl: accountLink.url,
      });

      await session.commitTransaction();
      console.log("[withdrawAmount] Transaction committed for onboarding", {
        ambassadorId,
      });

      return res.status(200).json({
        isSuccess: true,

        requiresOnboarding: true,

        onboardingCompleted: false,

        onboardingUrl: accountLink.url,

        message:
          "Stripe account created successfully. Please complete KYC before withdrawing.",
      });
    }

    // ======================================
    // Existing Stripe Account
    // ======================================

    console.log("[withdrawAmount] Retrieving Stripe account", {
      ambassadorId,
      stripeAccountId: user.stripeAccountId,
    });
    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    console.log("[withdrawAmount] Stripe account status", {
      ambassadorId,
      stripeAccountId: user.stripeAccountId,
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
    });

    if (
      !account.details_submitted ||
      !account.charges_enabled ||
      !account.payouts_enabled
    ) {
      console.log("[withdrawAmount] Stripe KYC onboarding required", {
        ambassadorId,
        stripeAccountId: user.stripeAccountId,
      });
      const accountLink = await stripe.accountLinks.create({
        account: user.stripeAccountId,

        refresh_url: `${process.env.APP_URL}/withdraw`,

        return_url: `${process.env.APP_URL}/withdraw-success`,

        type: "account_onboarding",
      });

      console.log(
        "[withdrawAmount] Stripe onboarding link created for existing account",
        {
          ambassadorId,
          onboardingUrl: accountLink.url,
        },
      );

      await session.commitTransaction();
      console.log("[withdrawAmount] Transaction committed for KYC redirect", {
        ambassadorId,
      });

      return res.status(200).json({
        isSuccess: true,

        requiresOnboarding: true,

        onboardingCompleted: false,

        onboardingUrl: accountLink.url,

        message:
          "Please complete your Stripe KYC before requesting withdrawal.",
      });
    }

    // ======================================
    // PART 2 STARTS HERE
    // ======================================
    const balanceBefore = wallet.availableBalance;
    const balanceAfter = balanceBefore - amount;
    console.log("[withdrawAmount] Wallet balances computed", {
      ambassadorId,
      balanceBefore,
      balanceAfter,
      amount,
    });

    // ======================================
    // Create Withdrawal Request
    // ======================================

    console.log("[withdrawAmount] Creating withdrawal record", {
      ambassadorId,
      amount,
      balanceBefore,
      balanceAfter,
    });
    const withdrawal = await AmbassadorWithdrawal.create(
      [
        {
          ambassador: ambassadorId,

          wallet: wallet._id,

          requestedAmount: amount,

          finalAmount: amount,

          currency: "eur",

          balanceBefore,

          balanceAfter,

          status: "pending",

          requestedAt: new Date(),
        },
      ],
      { session },
    );

    withdrawalDoc = withdrawal[0];
    console.log("[withdrawAmount] Withdrawal record created", {
      ambassadorId,
      withdrawalId: withdrawalDoc?._id,
    });

    // ======================================
    // Update Wallet
    // ======================================

    wallet.availableBalance = balanceAfter;

    wallet.reservedBalance += amount;

    await wallet.save({ session });
    console.log("[withdrawAmount] Wallet updated after withdrawal request", {
      ambassadorId,
      walletId: wallet._id,
      availableBalance: wallet.availableBalance,
      reservedBalance: wallet.reservedBalance,
    });

    // ======================================
    // Wallet History
    // ======================================

    console.log("[withdrawAmount] Wallet history step skipped for now", {
      ambassadorId,
    });

    // ======================================
    // Commit Mongo Transaction
    // ======================================

    await session.commitTransaction();
    console.log("[withdrawAmount] Mongo transaction committed", {
      ambassadorId,
      withdrawalId: withdrawalDoc?._id,
    });

    // ======================================
    // Transfer
    // Platform Account
    // →
    // Ambassador Connected Account
    // ======================================

    console.log("[withdrawAmount] Creating Stripe transfer", {
      ambassadorId,
      stripeAccountId: user.stripeAccountId,
      amount: Math.round(amount * 100),
    });
    transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100),

      currency: "eur",

      destination: user.stripeAccountId,

      metadata: {
        withdrawalId: withdrawalDoc._id.toString(),

        ambassadorId: ambassadorId.toString(),
      },
    });
    console.log("[withdrawAmount] Stripe transfer created", {
      ambassadorId,
      transferId: transfer.id,
    });

    withdrawalDoc.stripeTransferId = transfer.id;

    // ======================================
    // Payout
    // Connected Account
    // →
    // Ambassador Bank
    // ======================================

    console.log("[withdrawAmount] Creating Stripe payout", {
      ambassadorId,
      stripeAccountId: user.stripeAccountId,
      amount: Math.round(amount * 100),
      transferId: transfer.id,
    });
    const payout = await stripe.payouts.create(
      {
        amount: Math.round(amount * 100),

        currency: "eur",
        metadata: {
          withdrawalId: withdrawalDoc._id.toString(),

          transferId: transfer.id,
        },
      },
      {
        stripeAccount: user.stripeAccountId,

        idempotencyKey: withdrawalDoc._id.toString(),
      },
    );
    console.log("[withdrawAmount] Stripe payout created", {
      ambassadorId,
      payoutId: payout.id,
      arrivalDate: payout.arrival_date,
    });

    withdrawalDoc.stripePayoutId = payout.id;

    withdrawalDoc.stripeAccountId = user.stripeAccountId;

    withdrawalDoc.status = "processing";

    withdrawalDoc.arrivalDate = payout.arrival_date
      ? new Date(payout.arrival_date * 1000)
      : null;
    try {
      await withdrawalDoc.save();
      console.log("[withdrawAmount] Withdrawal document saved", {
        ambassadorId,
        withdrawalId: withdrawalDoc._id,
        status: withdrawalDoc.status,
      });
    } catch (e) {
      console.log("[withdrawAmount] Withdrawal save failed", {
        ambassadorId,
        error: e.message,
      });
    }
    console.log("[withdrawAmount] Success response prepared", {
      ambassadorId,
      withdrawalId: withdrawalDoc._id,
      status: withdrawalDoc.status,
      amount,
      availableBalance: wallet.availableBalance,
      reservedBalance: wallet.reservedBalance,
    });
    return res.status(200).json({
      isSuccess: true,

      message: "Withdrawal request created successfully.",

      withdrawalId: withdrawalDoc._id,

      status: withdrawalDoc.status,

      amount,

      availableBalance: wallet.availableBalance,

      reservedBalance: wallet.reservedBalance,
    });
  } catch (err) {
    console.log("[withdrawAmount] Error occurred", {
      ambassadorId,
      amount,
      error: err.message,
      stack: err.stack,
    });
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("[withdrawAmount] Transaction aborted after error", {
        ambassadorId,
      });
    }

    // Rollback Withdrawal

    if (withdrawalDoc) {
      console.log("[withdrawAmount] Updating withdrawal to failed", {
        ambassadorId,
        withdrawalId: withdrawalDoc._id,
      });
      try {
        await AmbassadorWithdrawal.findByIdAndUpdate(withdrawalDoc._id, {
          status: "failed",

          failureReason: err.message,
        });
      } catch (e) {
        console.log("[withdrawAmount] Unable to update withdrawal status", {
          ambassadorId,
          error: e.message,
        });
      }
      // Restore wallet
      if (!transfer) {
        const restoredWallet = await AmbassadorWallet.findOne({
          ambassador: ambassadorId,
        });

        if (restoredWallet) {
          restoredWallet.availableBalance += amount;

          restoredWallet.reservedBalance = Math.max(
            0,
            restoredWallet.reservedBalance - amount,
          );

          await restoredWallet.save();
          console.log("[withdrawAmount] Wallet restored after failure", {
            ambassadorId,
            walletId: restoredWallet._id,
            availableBalance: restoredWallet.availableBalance,
            reservedBalance: restoredWallet.reservedBalance,
          });
        }
      }

      if (wallet) {
        wallet.availableBalance += amount;

        wallet.reservedBalance = Math.max(0, wallet.reservedBalance - amount);

        await wallet.save();
        console.log("[withdrawAmount] Wallet balance adjusted in catch block", {
          ambassadorId,
          walletId: wallet._id,
          availableBalance: wallet.availableBalance,
          reservedBalance: wallet.reservedBalance,
        });
      }
    }

    return res.status(500).json({
      isSuccess: false,

      message: err.message,
    });
  } finally {
    console.log("[withdrawAmount] Session ending", { ambassadorId });
    await session.endSession();
  }
};
exports.handlePayoutCreated = async (payout) => {
  try {
    console.log("[handlePayoutCreated] Start", {
      payoutId: payout?.id,
      metadata: payout?.metadata,
    });

    const withdrawalId = payout.metadata?.withdrawalId;

    if (!withdrawalId) {
      console.log("[handlePayoutCreated] Withdrawal Id Missing", {
        payoutId: payout?.id,
      });
      return;
    }

    const withdrawal = await AmbassadorWithdrawal.findById(withdrawalId);

    if (!withdrawal) {
      console.log("[handlePayoutCreated] Withdrawal Not Found", {
        withdrawalId,
      });
      return;
    }

    if (withdrawal.stripePayoutId && withdrawal.stripePayoutId !== payout.id) {
      console.log("[handlePayoutCreated] Different payout already linked", {
        withdrawalId,
        existingPayoutId: withdrawal.stripePayoutId,
        incomingPayoutId: payout.id,
      });
      return;
    }
    withdrawal.stripePayoutId = payout.id;

    withdrawal.status = "processing";

    withdrawal.arrivalDate = payout.arrival_date
      ? new Date(payout.arrival_date * 1000)
      : null;

    await withdrawal.save();

    console.log("[handlePayoutCreated] Withdrawal updated", {
      withdrawalId,
      payoutId: payout.id,
      status: withdrawal.status,
    });
  } catch (err) {
    console.log("[handlePayoutCreated] Error", err);
  }
};
exports.handlePayoutUpdated = async (payout) => {
  try {
    console.log("[handlePayoutUpdated] Start", {
      payoutId: payout?.id,
      status: payout?.status,
      metadata: payout?.metadata,
    });

    const withdrawalId = payout.metadata?.withdrawalId;

    if (!withdrawalId) {
      console.log("[handlePayoutUpdated] Withdrawal Id Missing", {
        payoutId: payout?.id,
      });
      return;
    }

    const withdrawal = await AmbassadorWithdrawal.findById(withdrawalId);

    if (!withdrawal) {
      console.log("[handlePayoutUpdated] Withdrawal Not Found", {
        withdrawalId,
      });
      return;
    }

    if (withdrawal.stripePayoutId !== payout.id) {
      console.log("[handlePayoutUpdated] Invalid payout", {
        withdrawalId,
        expectedPayoutId: withdrawal.stripePayoutId,
        incomingPayoutId: payout.id,
      });
      return;
    }

    withdrawal.status =
      payout.status === "paid"
        ? "paid"
        : payout.status === "failed"
          ? "failed"
          : "processing";

    withdrawal.availableAt = payout.arrival_date
      ? new Date(payout.arrival_date * 1000)
      : withdrawal.arrivalDate;

    await withdrawal.save();

    console.log("[handlePayoutUpdated] Withdrawal updated", {
      withdrawalId,
      payoutId: payout.id,
      status: withdrawal.status,
    });
  } catch (err) {
    console.log("[handlePayoutUpdated] Error", err);
  }
};
exports.handlePayoutPaid = async (payout) => {
  const session = await mongoose.startSession();

  try {
    console.log("[handlePayoutPaid] Start", {
      payoutId: payout?.id,
      metadata: payout?.metadata,
    });
    session.startTransaction();

    const withdrawalId = payout.metadata?.withdrawalId;

    if (!withdrawalId) {
      console.log("[handlePayoutPaid] Withdrawal Id Missing", {
        payoutId: payout?.id,
      });
      await session.abortTransaction();
      return;
    }

    const withdrawal =
      await AmbassadorWithdrawal.findById(withdrawalId).session(session);

    if (!withdrawal) {
      console.log("[handlePayoutPaid] Withdrawal Not Found", { withdrawalId });
      await session.abortTransaction();
      return;
    }
    if (withdrawal.status === "paid") {
      console.log("[handlePayoutPaid] Withdrawal already completed", {
        withdrawalId,
      });
      await session.abortTransaction();
      return;
    }
    const wallet = await AmbassadorWallet.findOne({
      ambassador: withdrawal.ambassador,
    }).session(session);

    if (!wallet) {
      console.log("[handlePayoutPaid] Wallet not found", {
        ambassadorId: withdrawal.ambassador,
      });
      await session.abortTransaction();
      return;
    }

    if (wallet.reservedBalance < withdrawal.finalAmount) {
      console.log("[handlePayoutPaid] Reserved balance too low", {
        withdrawalId,
        reservedBalance: wallet.reservedBalance,
        finalAmount: withdrawal.finalAmount,
      });
      await session.abortTransaction();
      return;
    }

    const balanceBefore = wallet.availableBalance;
    console.log("[handlePayoutPaid] Wallet before payout completion", {
      withdrawalId,
      balanceBefore,
      reservedBalance: wallet.reservedBalance,
      finalAmount: withdrawal.finalAmount,
    });

    wallet.reservedBalance -= withdrawal.finalAmount;

    wallet.totalWithdrawn += withdrawal.finalAmount;

    await wallet.save({ session });
    const exists = await AmbassadorWalletHistory.findOne({
      ambassador: withdrawal.ambassador,
      type: "withdrawal",
      stripePayoutId: payout.id,
    }).session(session);

    if (exists) {
      console.log("[handlePayoutPaid] Duplicate payout history found", {
        withdrawalId,
        payoutId: payout.id,
      });
      await session.abortTransaction();
      return;
    }
    await AmbassadorWalletHistory.create(
      [
        {
          ambassador: withdrawal.ambassador,

          transactionType: "debit",

          type: "withdrawal",

          amount: withdrawal.finalAmount,

          balanceBefore,

          balanceAfter: wallet.availableBalance,
          note: "Stripe payout completed",
        },
      ],
      { session },
    );

    withdrawal.status = "paid";

    withdrawal.processedAt = new Date();

    await withdrawal.save({ session });

    await session.commitTransaction();

    console.log("[handlePayoutPaid] Withdrawal completed", {
      withdrawalId,
      payoutId: payout.id,
      status: withdrawal.status,
    });
  } catch (err) {
    console.log("[handlePayoutPaid] Error", err);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
  } finally {
    console.log("[handlePayoutPaid] Session ending");
    session.endSession();
  }
};
exports.handlePayoutFailed = async (payout) => {
  const session = await mongoose.startSession();

  try {
    console.log("[handlePayoutFailed] Start", {
      payoutId: payout?.id,
      status: payout?.status,
      metadata: payout?.metadata,
    });
    session.startTransaction();

    const withdrawalId = payout.metadata?.withdrawalId;

    if (!withdrawalId) {
      console.log("[handlePayoutFailed] Withdrawal Id Missing", {
        payoutId: payout?.id,
      });
      await session.abortTransaction();
      return;
    }

    const withdrawal =
      await AmbassadorWithdrawal.findById(withdrawalId).session(session);

    if (!withdrawal) {
      console.log("[handlePayoutFailed] Withdrawal Not Found", {
        withdrawalId,
      });
      await session.abortTransaction();
      return;
    }
    if (withdrawal.status === "paid") {
      console.log("[handlePayoutFailed] Withdrawal already completed", {
        withdrawalId,
      });
      await session.abortTransaction();
      return;
    }

    if (withdrawal.stripePayoutId !== payout.id) {
      console.log("[handlePayoutFailed] Invalid payout", {
        withdrawalId,
        expectedPayoutId: withdrawal.stripePayoutId,
        incomingPayoutId: payout.id,
      });
      await session.abortTransaction();
      return;
    }

    const wallet = await AmbassadorWallet.findOne({
      ambassador: withdrawal.ambassador,
    }).session(session);

    if (!wallet) {
      console.log("[handlePayoutFailed] Wallet not found", {
        ambassadorId: withdrawal.ambassador,
      });
      await session.abortTransaction();
      return;
    }

    if (wallet.reservedBalance < withdrawal.finalAmount) {
      console.log("[handlePayoutFailed] Reserved balance too low", {
        withdrawalId,
        reservedBalance: wallet.reservedBalance,
        finalAmount: withdrawal.finalAmount,
      });
      await session.abortTransaction();
      return;
    }
    if (withdrawal.status === "failed") {
      console.log("[handlePayoutFailed] Withdrawal already failed", {
        withdrawalId,
      });
      await session.abortTransaction();
      return;
    }

    console.log("[handlePayoutFailed] Releasing reserved balance", {
      withdrawalId,
      reservedBalanceBefore: wallet.reservedBalance,
      finalAmount: withdrawal.finalAmount,
    });
    wallet.reservedBalance = Math.max(
      0,
      wallet.reservedBalance - withdrawal.finalAmount,
    );

    wallet.availableBalance += withdrawal.finalAmount;

    await wallet.save({ session });

    withdrawal.status = "failed";

    withdrawal.failureReason =
      payout.failure_code || payout.failure_message || "Stripe payout failed";

    withdrawal.failureCode = payout.failure_code || null;

    withdrawal.failedAt = new Date();

    await withdrawal.save({ session });

    await session.commitTransaction();

    console.log("[handlePayoutFailed] Withdrawal failed", {
      withdrawalId,
      payoutId: payout.id,
      status: withdrawal.status,
    });
  } catch (err) {
    console.log("[handlePayoutFailed] Error", err);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
  } finally {
    console.log("[handlePayoutFailed] Session ending");
    session.endSession();
  }
};
