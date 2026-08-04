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
const PendingAmbassadorAssignment = require("../model/PendingAmbassadorAssignment");
const path = require("path");
const mongoose = require("mongoose");
const AmbassadorWallet = require("../model/AmbassadorWallet");
const { sendOtpEmail, sendCredentialsEmail } = require("../utils/email");
const {
  sendAmbassadorApprovedNotification,
  sendAmbassadorRemovedNotification,
  sendAmbassadorRejectedNotification,
  sendAmbassadorInvitationNotification,
} = require("./notificationController");
const AmbassadorWalletHistory = require("../model/AmbassadorWalletHistory");
const {
  sendExclusiveAmbassadorInvitationNotification,
} = require("./notificationController");

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
    // remark: handle ambassador application submission from self or exclusive requests

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

    console.log("[applyForAmbassador] Start", {
      userId,
      applicationType,
      requestedUserId,
      nameProvided: Boolean(name),
      emailProvided: Boolean(email),
      phoneProvided: Boolean(phoneNumber),
      cityProvided: Boolean(city),
    });

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

    console.log("[applyForAmbassador] Loaded user", {
      userId,
      exists: Boolean(user),
      isAmbassador: user?.isAmbassador,
      ambassadorStatus: user?.ambassadorStatus,
    });

    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // =====================================
    // EXCLUSIVE AMBASSADOR REQUEST VALIDATION
    // =====================================

    if (applicationType === "exclusive_invitation") {
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

    if (applicationType === "exclusive_invitation") {
      if (!requestedUserId) {
        console.log("[applyForAmbassador] exclusive_invitation missing requestedUserId");
        return res.status(400).json({
          isSuccess: false,
          message: "requestedUserId is required",
        });
      }

      requestedUser = await User.findById(requestedUserId);

      console.log("[applyForAmbassador] Loaded requestedUser", {
        requestedUserId,
        exists: Boolean(requestedUser),
        isAmbassador: requestedUser?.isAmbassador,
      });

      if (!requestedUser) {
        return res.status(404).json({
          isSuccess: false,
          message: "Requested user not found",
        });
      }
if (requestedUser.isAmbassador) {
  return res.status(400).json({
    isSuccess: false,
    message:
      "This user has already accepted the invitation and is now an ambassador. You cannot send another invitation.",
  });
}
      if (String(requestedUser._id) === String(user._id)) {
        return res.status(400).json({
          isSuccess: false,
          message: "You cannot invite yourself.",
        });
      }
      

      const pendingInvitation = await PendingAmbassadorAssignment.findOne({
        user: requestedUser._id,
        createdByUser: user._id,
        status: "pending",
      });

      if (pendingInvitation) {
        console.log("[applyForAmbassador] Pending invitation exists", {
          requestedUserId,
          createdByUser: user._id,
        });
        return res.status(400).json({
          isSuccess: false,
          message: "This invitation is still pending.",
        });
      }
      const lastInvitation = await PendingAmbassadorAssignment.findOne({
        user: requestedUser._id,
        createdByUser: user._id,
      }).sort({ createdAt: -1 });

      if (lastInvitation) {
        const nextAllowedTime = new Date(
          lastInvitation.createdAt.getTime() + 24 * 60 * 60 * 1000,
        );

        if (new Date() < nextAllowedTime) {
          console.log("[applyForAmbassador] Invitation cooldown active", {
            requestedUserId,
            nextAllowedTime: nextAllowedTime.toISOString(),
          });
          return res.status(400).json({
            isSuccess: false,
            message: `You can send another invitation after ${nextAllowedTime.toLocaleString()}.`,
          });
        }
      }

     
    }

    // ==========================
    // Pending Application Check
    // ==========================
    let existingApplication = null;

    if (applicationType === "self") {
      existingApplication = await AmbassadorApplication.findOne({
        user: userId,
        applicationType: "self",
        status: "pending",
      });
    }

    if (existingApplication) {
      console.log("[applyForAmbassador] Existing pending application found", {
        userId,
        applicationId: existingApplication._id,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "You already have a pending ambassador application",
      });
    }

    let lastRejectedApplication = null;

    if (applicationType === "self") {
      lastRejectedApplication = await AmbassadorApplication.findOne({
        user: userId,
        applicationType: "self",
        status: "rejected",
      }).sort({
        created_at: -1,
      });
    }
    console.log("Last rejected application:", lastRejectedApplication);

if (lastRejectedApplication) {
  console.log(
    "Cooldown Until:",
    lastRejectedApplication.rejectionCooldownUntil
  );
  console.log("Current Time:", new Date());
}
    if (
      lastRejectedApplication &&
      lastRejectedApplication.rejectionCooldownUntil &&
      new Date() < lastRejectedApplication.rejectionCooldownUntil
    ) {
        console.log("❌ Cooldown Active");

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
    let invitation;

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
      console.log("[applyForAmbassador] Created application", {
        applicationId: application._id,
        userId,
      });
    }

    // =====================================
    // EXCLUSIVE REQUEST
    // =====================================
    else {
      invitation = await PendingAmbassadorAssignment.create({
        user: requestedUser._id,

        assignmentSource: "exclusive",

        createdByUser: user._id,

        ambassadorType: "standard",

        commissionRate: user.commissionRate,

        parentAmbassador: user._id,

        territories: [],

        status: "pending",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      console.log("[applyForAmbassador] Created exclusive invitation", {
        invitationId: invitation._id,
        requestedUser: requestedUser._id,
        createdBy: user._id,
      });
      await sendExclusiveAmbassadorInvitationNotification(requestedUser, user);
    }

    if (applicationType === "self") {
      return res.status(201).json({
        isSuccess: true,
        message: "Ambassador application submitted successfully",
        application,
      });
    }

    console.log("[applyForAmbassador] Invitation flow completed", {
      invitationId: invitation?._id,
      requestedUserId,
    });
    return res.status(200).json({
      isSuccess: true,
      message: "Invitation sent successfully.",
      invitation,
    });
  } catch (err) {
    console.error("[applyForAmbassador] Error:", err?.message || err);
    console.error("[applyForAmbassador] Stack:", err?.stack || "no-stack");

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
    // remark: retrieve the current user's ambassador application details
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
      const invitations = await PendingAmbassadorAssignment.find({
        assignmentSource: "exclusive",
        createdByUser: userId,
      })
        .populate(
          "user",
          "name email mobile city profile_image isAmbassador ambassadorStatus",
        )
        .populate("createdByUser", "name email ambassadorCode")
        .populate("territories", "city country")
        .sort({
          createdAt: -1,
        });

      return res.json({
        isSuccess: true,
        applicationType: "exclusive_invitation",
        totalRequests: invitations.length,
        invitations,
      });
    }

    const application = await AmbassadorApplication.find({
      user: userId,
      applicationType: "self",
    })

      .sort({
        created_at: -1,
      });

    return res.json({
      isSuccess: true,
      applicationType: "self",
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
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { applicationId } = req.params;
    const { ambassadorType, territoryIds, parentAmbassadorId, commissionRate } =
      req.body;

    console.log("[approveApplication] Start", {
      applicationId,
      ambassadorType,
      territoryIdsCount: Array.isArray(territoryIds) ? territoryIds.length : 0,
      parentAmbassadorId,
      commissionRate,
      adminId: req.admin?.id,
    });

    const application =
      await AmbassadorApplication.findById(applicationId).session(session);

    console.log("[approveApplication] Loaded application", {
      applicationId,
      exists: Boolean(application),
      status: application?.status,
    });

    if (!application) {
      await session.abortTransaction();

      return res.status(404).json({
        isSuccess: false,
        message: "Application not found",
      });
    }

    if (application.status !== "pending") {
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "Application already processed",
      });
    }

    const user = await User.findById(application.user).session(session);
    let uniqueTerritoryIds = [];

    console.log("[approveApplication] Loaded user", {
      userId: application.user?.toString(),
      exists: Boolean(user),
      isAmbassador: user?.isAmbassador,
    });

    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    if (user.isAmbassador) {
      await session.abortTransaction();
      return res.status(400).json({
        isSuccess: false,
        message: "User is already ambassador",
      });
    }

    if (!["standard", "exclusive"].includes(ambassadorType)) {
      await session.abortTransaction();
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
      await session.abortTransaction();
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate is required",
      });
    }

    if (Number(commissionRate) < 0 || Number(commissionRate) > 12) {
      await session.abortTransaction();
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate must be between 0 and 12",
      });
    }

    // =====================================
    // COMMON AMBASSADOR SETTINGS
    // =====================================
    console.log("[approveApplication] Applying ambassador settings", {
      userId: user._id.toString(),
      ambassadorType,
      commissionRate: Number(commissionRate),
    });

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
      console.log("[approveApplication] Generated ambassador code", {
        ambassadorCode: user.ambassadorCode,
      });
    }

    // =====================================
    // STANDARD AMBASSADOR
    // =====================================
    if (ambassadorType === "standard") {
      console.log("[approveApplication] Standard ambassador path", {
        parentAmbassadorId,
      });
      user.parentAmbassador = null;

      if (parentAmbassadorId) {
        const parent = await User.findById(parentAmbassadorId).session(session);

        if (!parent) {
          await session.abortTransaction();
          return res.status(404).json({
            isSuccess: false,
            message: "Parent ambassador not found",
          });
        }

        if (!parent.isAmbassador || parent.ambassadorStatus !== "approved") {
          await session.abortTransaction();
          return res.status(400).json({
            isSuccess: false,
            message: "Parent ambassador is not active",
          });
        }

        if (parent.ambassadorType !== "exclusive") {
          await session.abortTransaction();
          return res.status(400).json({
            isSuccess: false,
            message: "Parent ambassador must be an exclusive ambassador",
          });
        }

        user.parentAmbassador = parent._id;
        console.log("[approveApplication] Parent ambassador assigned", {
          parentAmbassadorId,
          parentAmbassador: parent._id.toString(),
        });
      }
    }

    // =====================================
    // EXCLUSIVE AMBASSADOR
    // =====================================
    if (ambassadorType === "exclusive") {
      console.log("[approveApplication] Exclusive ambassador path", {
        territoryIdsCount: Array.isArray(territoryIds) ? territoryIds.length : 0,
      });
      user.parentAmbassador = null;

      if (
        !territoryIds ||
        !Array.isArray(territoryIds) ||
        territoryIds.length === 0
      ) {
        await session.abortTransaction();
        return res.status(400).json({
          isSuccess: false,
          message: "territoryIds is required for exclusive ambassador",
        });
      }

      uniqueTerritoryIds = [...new Set(territoryIds)];
      console.log("[approveApplication] Unique territory IDs", {
        uniqueTerritoryIds,
      });

      const territories = await Territory.find({
        _id: { $in: uniqueTerritoryIds },
      }).session(session);

      console.log("[approveApplication] Territories loaded", {
        expected: uniqueTerritoryIds.length,
        found: territories.length,
      });

      if (territories.length !== uniqueTerritoryIds.length) {
        await session.abortTransaction();
        return res.status(404).json({
          isSuccess: false,
          message: "One or more territories not found",
        });
      }

      for (const territory of territories) {
        if (territory.exclusiveAmbassador) {
          await session.abortTransaction();
          return res.status(400).json({
            isSuccess: false,
            message: `${territory.city} is already assigned to another ambassador`,
          });
        }
      }

      for (const territory of territories) {
        territory.exclusiveAmbassador = user._id;
        territory.assignedAt = new Date();
        territory.reviewDueAt = new Date(
          Date.now() + 180 * 24 * 60 * 60 * 1000,
        );

        await territory.save({ session });
        console.log("[approveApplication] Territory assigned", {
          territoryId: territory._id.toString(),
          city: territory.city,
        });
      }
    }

    await user.save({ session });
    console.log("[approveApplication] User updated", {
      userId: user._id.toString(),
      ambassadorType: user.ambassadorType,
    });

    // =====================================
    // CREATE WALLET
    // =====================================
    const existingWallet = await AmbassadorWallet.findOne({
      ambassador: user._id,
    }).session(session);

    if (!existingWallet) {
      await AmbassadorWallet.create(
        [
          {
            ambassador: user._id,
          },
        ],
        { session },
      );
      console.log("[approveApplication] Created ambassador wallet", {
        ambassadorId: user._id.toString(),
      });
    }

    // =====================================
    // UPDATE APPLICATION
    // =====================================
    console.log("[approveApplication] Updating application status", {
      applicationId,
      status: "approved",
    });
    application;

    application.status = "approved";

    application.reviewedBy = req.admin.id;

    application.reviewedAt = new Date();

    await application.save({ session });

    await session.commitTransaction();
    console.log("[approveApplication] Transaction committed", {
      applicationId,
    });

    // =====================================
    // NOTIFICATION
    // =====================================
    try {
      await sendAmbassadorApprovedNotification(user);
      console.log("[approveApplication] Approval notification sent", {
        userId: user._id.toString(),
      });
    } catch (e) {
      console.error("[approveApplication] Notification error", e);
    }

    return res.json({
      isSuccess: true,
      message: "Ambassador approved successfully",
      user: {
        _id: user._id,
        name: user.name,
        ambassadorType: user.ambassadorType,
        commissionRate: user.commissionRate,
        ambassadorCode: user.ambassadorCode,
        territories: ambassadorType === "exclusive" ? uniqueTerritoryIds : [],
        parentAmbassador: user.parentAmbassador,
      },
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("[approveApplication] Transaction aborted due to error", {
        error: err?.message || err,
      });
    }

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  } finally {
    session.endSession();
    console.log("[approveApplication] Session ended", {
      applicationId: req.params.applicationId,
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
    console.log("[rejectApplication] Start", {
      applicationId,
      reason,
    });
    // remark: reject ambassador application and notify user
    const application = await AmbassadorApplication.findById(applicationId);

    if (!application) {
      return res.status(404).json({
        isSuccess: false,
        message: "Application not found",
      });
    }
    if (application.applicationType !== "self") {
      return res.status(400).json({
        isSuccess: false,
        message: "Only self ambassador applications can be rejected.",
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
      Date.now() + 24 * 60 * 60 * 1000,
    );

    await application.save();

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
      message: "Ambassador application rejected successfully",
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
    // remark: directly convert a user into an ambassador with optional territory or parent assignment
    const { ambassadorType, territoryIds, parentAmbassadorId, commissionRate } =
      req.body;

    console.log("[makeAmbassador] Start", {
      userId,
      adminId: req.admin?.id,
      ambassadorType,
      territoryIdsCount: Array.isArray(territoryIds) ? territoryIds.length : 0,
      parentAmbassadorId,
      commissionRate,
    });

    const user = await User.findById(userId);
    console.log("[makeAmbassador] User lookup result", {
      userId,
      userExists: Boolean(user),
      isAmbassador: user?.isAmbassador,
    });

    if (!user) {
      console.log("[makeAmbassador] User not found", { userId });
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    if (user.isAmbassador) {
      console.log("[makeAmbassador] User already ambassador", { userId });
      return res.status(400).json({
        isSuccess: false,
        message: "User is already ambassador",
      });
    }

    // =====================================
    // CHECK EXISTING PENDING INVITATION
    // =====================================

    const existingPendingAssignment = await PendingAmbassadorAssignment.findOne(
      {
        user: user._id,
        status: "pending",
      },
    );
    console.log("[makeAmbassador] Existing pending assignment check", {
      userId,
      pendingExists: Boolean(existingPendingAssignment),
    });

    if (existingPendingAssignment) {
      return res.status(400).json({
        isSuccess: false,
        message: "User already has a pending ambassador invitation.",
      });
    }

    if (
      !ambassadorType ||
      !["standard", "exclusive"].includes(ambassadorType)
    ) {
      console.log("[makeAmbassador] Invalid ambassadorType", {
        ambassadorType,
      });
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
      console.log("[makeAmbassador] Invalid commissionRate", {
        commissionRate,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate is required",
      });
    }

    if (Number(commissionRate) < 0 || Number(commissionRate) > 12) {
      console.log("[makeAmbassador] commissionRate out of range", {
        commissionRate,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "commissionRate must be between 0 and 12",
      });
    }

    const parsedCommissionRate = Number(commissionRate);

    // =====================================
    // STANDARD AMBASSADOR VALIDATION
    // =====================================

    let parent = null;
    if (ambassadorType === "standard") {
      console.log("[makeAmbassador] Standard ambassador validation start", {
        parentAmbassadorId,
      });
      if (!parentAmbassadorId) {
        console.log(
          "[makeAmbassador] parentAmbassadorId missing for standard ambassador",
        );
        return res.status(400).json({
          isSuccess: false,
          message: "parentAmbassadorId is required for standard ambassador",
        });
      }

      parent = await User.findById(parentAmbassadorId);
      console.log("[makeAmbassador] Parent ambassador lookup result", {
        parentAmbassadorId,
        parentExists: Boolean(parent),
        parentAmbassadorType: parent?.ambassadorType,
        parentAmbassadorStatus: parent?.ambassadorStatus,
      });

      if (!parent || !parent.isAmbassador) {
        return res.status(400).json({
          isSuccess: false,
          message: "Parent ambassador not found",
        });
      }

      if (parent.ambassadorType !== "exclusive") {
        console.log("[makeAmbassador] Parent ambassador invalid type", {
          parentAmbassadorId,
          parentType: parent.ambassadorType,
        });
        return res.status(400).json({
          isSuccess: false,
          message: "Parent ambassador must be an exclusive ambassador",
        });
      }
    }

    // =====================================
    // EXCLUSIVE AMBASSADOR VALIDATION
    // =====================================

    let uniqueTerritoryIds = [];
    if (ambassadorType === "exclusive") {
      console.log("[makeAmbassador] Exclusive ambassador validation start", {
        territoryIdsCount: Array.isArray(territoryIds)
          ? territoryIds.length
          : 0,
      });
      if (
        !territoryIds ||
        !Array.isArray(territoryIds) ||
        territoryIds.length === 0
      ) {
        console.log("[makeAmbassador] territoryIds missing or invalid");
        return res.status(400).json({
          isSuccess: false,
          message: "territoryIds is required for exclusive ambassador",
        });
      }

      uniqueTerritoryIds = [...new Set(territoryIds)];
      console.log("[makeAmbassador] Unique territoryIds", {
        uniqueTerritoryIds,
      });
      const territories = await Territory.find({
        _id: {
          $in: uniqueTerritoryIds,
        },
      });
      console.log("[makeAmbassador] Territories found", {
        expected: uniqueTerritoryIds.length,
        found: territories.length,
      });

      if (territories.length !== uniqueTerritoryIds.length) {
        console.log("[makeAmbassador] Territory count mismatch", {
          uniqueTerritoryIds,
          foundIds: territories.map((t) => t._id.toString()),
        });
        return res.status(404).json({
          isSuccess: false,
          message: "One or more territories not found",
        });
      }

      for (const territory of territories) {
        if (
          territory.exclusiveAmbassador &&
          territory.exclusiveAmbassador.toString() !== user._id.toString()
        ) {
          console.log("[makeAmbassador] Territory already assigned", {
            territoryId: territory._id.toString(),
            city: territory.city,
            exclusiveAmbassador: territory.exclusiveAmbassador.toString(),
          });
          return res.status(400).json({
            isSuccess: false,
            message: `${territory.city} is already assigned to another ambassador`,
          });
        }
      }
    }

    // =====================================
    // CREATE PENDING ASSIGNMENT
    // =====================================

    console.log("[makeAmbassador] Creating pending ambassador assignment", {
      userId,
      ambassadorType,
      parsedCommissionRate,
      parentAmbassadorId,
      uniqueTerritoryIds,
    });
    const pendingAssignment = await PendingAmbassadorAssignment.create({
      user: user._id,

      assignmentSource: "admin",

      createdByAdmin: req.admin.id,

      ambassadorType,

      commissionRate: parsedCommissionRate,

      parentAmbassador:
        ambassadorType === "standard" ? parentAmbassadorId : null,

      territories: ambassadorType === "exclusive" ? uniqueTerritoryIds : [],

      status: "pending",

      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // optional
    });

    console.log("[makeAmbassador] Pending assignment created", {
      pendingAssignmentId: pendingAssignment._id.toString(),
    });

    // =====================================
    // NOTIFICATION
    // =====================================

    try {
      await sendAmbassadorInvitationNotification(user);
      console.log("[makeAmbassador] Invitation notification sent", { userId });
    } catch (notificationError) {
      console.error(
        "[makeAmbassador] Failed to send ambassador invitation notification",
        notificationError,
      );
    }

    return res.json({
      isSuccess: true,
      message:
        "Ambassador invitation sent successfully. User must accept the agreement before becoming an ambassador.",
      pendingAssignment,
    });
  } catch (err) {
    console.error("[makeAmbassador] Error", {
      error: err.message,
      stack: err.stack,
      params: req.params,
      body: req.body,
    });
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
    console.log("[getAllApplications] Start");

    const applications = await AmbassadorApplication.find({
      applicationType: "self",
    })
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

      // Application Details
      status: app.status,
      applicationType: app.applicationType,
      city: app.city,

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

      // User Details
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
            isAmbassador: app.user.isAmbassador,
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
    console.log("[getAllAmbassadors] Start", {
      adminId: req.admin?.id,
      query: req.query,
    });
    // remark: list all ambassadors with wallet and parent/sub counts
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
        
        parentAmbassador
        created_at
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

    console.log("[getAllAmbassadors] Ambassadors loaded", {
      count: ambassadors.length,
    });

    const ambassadorIds = ambassadors.map((ambassador) => ambassador._id);

    const wallets = await AmbassadorWallet.find({
      ambassador: {
        $in: ambassadorIds,
      },
    });

    console.log("[getAllAmbassadors] Wallets loaded", {
      ambassadorIdsCount: ambassadorIds.length,
      walletsCount: wallets.length,
    });

    const walletMap = {};

    wallets.forEach((wallet) => {
      walletMap[wallet.ambassador.toString()] = wallet;
    });

    const formattedAmbassadors = await Promise.all(
      ambassadors.map(async (ambassador) => {
        const wallet = walletMap[ambassador._id.toString()];
        const territories =
          ambassador.ambassadorType === "exclusive"
            ? await Territory.find({
                exclusiveAmbassador: ambassador._id,
              }).select("city country active kpiTarget")
            : [];

        console.log("[getAllAmbassadors] Ambassador enrichment", {
          ambassadorId: ambassador._id.toString(),
          ambassadorType: ambassador.ambassadorType,
          territoriesCount: territories.length,
        });

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

          territories,
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

    console.log("[getAllAmbassadors] Returning response", {
      count: formattedAmbassadors.length,
    });

    return res.status(200).json({
      isSuccess: true,

      count: formattedAmbassadors.length,

      ambassadors: formattedAmbassadors,
    });
  } catch (err) {
    console.error("[getAllAmbassadors] Error:", err?.message || err);
    console.error("[getAllAmbassadors] Stack:", err?.stack || "no-stack");

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
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { userId } = req.params;

    // ====================================================
    // USER
    // ====================================================

    const user = await User.findById(userId).session(session);

    if (!user) {
      await session.abortTransaction();

      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // ====================================================
    // ALREADY NOT AMBASSADOR
    // ====================================================

    if (!user.isAmbassador) {
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "User is not an ambassador",
      });
    }

    // ====================================================
    // CHECK ACTIVE SUB AMBASSADORS
    // ====================================================

    const subAmbassadorCount = await User.countDocuments({
      parentAmbassador: user._id,
      isAmbassador: true,
      ambassadorStatus: "approved",
    }).session(session);

    if (subAmbassadorCount > 0) {
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: `Cannot remove ambassador. ${subAmbassadorCount} active sub ambassadors are still assigned.`,
      });
    }

    // ====================================================
    // REMOVE TERRITORY ASSIGNMENT
    // (Exclusive Ambassador Only)
    // ====================================================

    if (user.ambassadorType === "exclusive") {
      await Territory.updateMany(
        {
          exclusiveAmbassador: user._id,
        },
        {
          $set: {
            exclusiveAmbassador: null,
            assignedAt: null,
            reviewDueAt: null,
          },
        },
        {
          session,
        },
      );
    }

    // ====================================================
    // PART 2 STARTS HERE
    // ====================================================
    //ambassador create a new user under them (for referral or other purposes)
    // ====================================================
    // RESET AMBASSADOR FIELDS
    // ====================================================

    user.isAmbassador = false;

    user.ambassadorStatus = "disabled";

    user.ambassadorType = null;

    user.parentAmbassador = null;

    user.commissionRate = 0;

    user.completedPaidServices = 0;

    user.ambassadorApprovedAt = null;

    user.ambassadorApprovedBy = null;

    user.ambassadorReviewDueAt = null;

    user.ambassadorAgreementAccepted = false;

    user.ambassadorAgreementAcceptedAt = null;

    user.registeredAfterAmbassadorApproval = false;

    // Preserve historical data
    // ambassadorCode
    // referralCode
    // totalReferralUsers
    // totalReferralEarned

    await user.save({ session });

    // ====================================================
    // UPDATE LATEST APPROVED APPLICATION
    // ====================================================

    await AmbassadorApplication.findOneAndUpdate(
      {
        user: user._id,
        status: "approved",
      },
      {
        $set: {
          status: "disabled",
        },
      },
      {
        sort: {
          created_at: -1,
        },
        session,
      },
    );

    // ====================================================
    // EXPIRE PENDING INVITATIONS (IF ANY)
    // ====================================================

    await PendingAmbassadorAssignment.updateMany(
      {
        user: user._id,
        status: "pending",
      },
      {
        $set: {
          status: "expired",
        },
      },
      {
        session,
      },
    );

    // ====================================================
    // COMMIT
    // ====================================================

    await session.commitTransaction();

    // ====================================================
    // SEND NOTIFICATION
    // ====================================================

    try {
      await sendAmbassadorRemovedNotification(user);
    } catch (err) {
      console.error("[removeAmbassador] Notification Error", err.message);
    }

    // ====================================================
    // RESPONSE
    // ====================================================

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
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("[removeAmbassador]", err);

    return res.status(500).json({
      isSuccess: false,

      message: err.message,
    });
  } finally {
    session.endSession();
  }
};
exports.createUserByAmbassador = async (req, res) => {
  try {
    const ambassadorId = req.user.id;
    console.log("[createUserByAmbassador] Start", {
      ambassadorId,
      body: req.body,
    });
    // remark: ambassador creates a new user account by sending OTP for verification
    const { name, email, mobile } = req.body;

    console.log("[createUserByAmbassador] Parsed input", {
      nameProvided: Boolean(name),
      emailProvided: Boolean(email),
      mobileProvided: Boolean(mobile),
    });

    if (!name || !email || !mobile) {
      console.log(
        "[createUserByAmbassador] Validation failed: missing fields",
        {
          missingName: !name,
          missingEmail: !email,
          missingMobile: !mobile,
        },
      );
      return res.status(400).json({
        isSuccess: false,
        message: "Name, email and mobile are required",
      });
    }

    const ambassador = await User.findById(ambassadorId);
    console.log("[createUserByAmbassador] Ambassador lookup result", {
      ambassadorId,
      found: Boolean(ambassador),
    });

    if (!ambassador) {
      console.log("[createUserByAmbassador] Ambassador not found", {
        ambassadorId,
      });
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
      console.log(
        "[createUserByAmbassador] Ambassador not approved to create users",
        {
          ambassadorId,
          isAmbassador: ambassador.isAmbassador,
          ambassadorStatus: ambassador.ambassadorStatus,
        },
      );
      return res.status(403).json({
        isSuccess: false,
        message: "Only approved ambassadors can create users",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log("[createUserByAmbassador] Normalized email", {
      normalizedEmail,
    });

    // Ambassador cannot register himself
    if (
      ambassador.email &&
      ambassador.email.toLowerCase().trim() === normalizedEmail
    ) {
      console.log(
        "[createUserByAmbassador] Ambassador attempted self-registration",
        {
          ambassadorId,
          email: normalizedEmail,
        },
      );
      return res.status(400).json({
        isSuccess: false,
        message: "You cannot register yourself as a user",
      });
    }

    let user = await User.findOne({
      email: normalizedEmail,
    });
    console.log("[createUserByAmbassador] Existing user lookup", {
      normalizedEmail,
      userExists: Boolean(user),
    });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    if (user) {
      // Strong check
      if (user.otp_verified || user.is_active || user.hashed_password) {
        console.log(
          "[createUserByAmbassador] User already active or verified",
          {
            userId: user._id,
            otp_verified: user.otp_verified,
            is_active: user.is_active,
            hasPassword: Boolean(user.hashed_password),
          },
        );
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
        console.log(
          "[createUserByAmbassador] Email already reserved by another ambassador",
          {
            userId: user._id,
            registeredByAmbassador: user.registeredByAmbassador,
            currentAmbassadorId: ambassador._id,
          },
        );
        return res.status(400).json({
          isSuccess: false,
          message: "User registration already started by another ambassador",
        });
      }

      if (
        user.lastResendAt &&
        Date.now() - new Date(user.lastResendAt).getTime() < 60 * 1000
      ) {
        console.log("[createUserByAmbassador] OTP resend cooldown active", {
          userId: user._id,
          lastResendAt: user.lastResendAt,
        });
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
      console.log("[createUserByAmbassador] OTP resent to existing user", {
        userId: user._id,
        email: normalizedEmail,
        otpExpiry,
      });

      await sendOtpEmail(user.email, otp);
      console.log("[createUserByAmbassador] OTP email sent", {
        email: user.email,
      });

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
    console.log("[createUserByAmbassador] OTP email sent", {
      email: user.email,
      userId: user._id,
    });

    return res.status(201).json({
      isSuccess: true,
      message: "OTP sent successfully",
      userId: user._id,
    });
  } catch (err) {
    console.error("[createUserByAmbassador] Error:", err?.message || err);
    console.error("[createUserByAmbassador] Stack:", err?.stack || "no-stack");
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

exports.verifyUserOtpByAmbassador = async (req, res) => {
  try {
    const ambassadorId = req.user.id;
    console.log("[verifyUserOtpByAmbassador] Start", {
      ambassadorId,
      body: req.body,
    });
    // remark: ambassador verifies OTP for a created user and sends password setup email
    const { userId, otp } = req.body;
    console.log("[verifyUserOtpByAmbassador] Parsed input", {
      userId,
      otpProvided: Boolean(otp),
    });

    if (!userId || !otp) {
      console.log(
        "[verifyUserOtpByAmbassador] Validation failed: missing userId or otp",
        {
          userId,
          otpProvided: Boolean(otp),
        },
      );
      return res.status(400).json({
        isSuccess: false,
        message: "userId and otp are required",
      });
    }

    const user = await User.findById(userId);
    console.log("[verifyUserOtpByAmbassador] User lookup result", {
      userId,
      userExists: Boolean(user),
      otpVerified: user?.otp_verified,
      isActive: user?.is_active,
    });

    if (!user) {
      console.log("[verifyUserOtpByAmbassador] User not found", { userId });
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
      console.log(
        "[verifyUserOtpByAmbassador] Ambassador not authorized to verify user",
        {
          ambassadorId,
          userId,
          registeredByAmbassador: user.registeredByAmbassador,
        },
      );
      return res.status(403).json({
        isSuccess: false,
        message: "You are not allowed to verify this user",
      });
    }

    // Already verified
    if (user.otp_verified && user.is_active) {
      console.log("[verifyUserOtpByAmbassador] User already verified", {
        userId,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "User already verified",
      });
    }

    // OTP expired
    if (!user.otp_expiry || user.otp_expiry < new Date()) {
      console.log("[verifyUserOtpByAmbassador] OTP expired", {
        userId,
        otpExpiry: user.otp_expiry,
      });
      return res.status(400).json({
        isSuccess: false,
        message: "OTP expired",
      });
    }

    // Wrong OTP
    if (String(user.otp_code) !== String(otp).trim()) {
      console.log("[verifyUserOtpByAmbassador] Invalid OTP entered", {
        userId,
        enteredOtp: otp,
        expectedOtp: user.otp_code ? "present" : "missing",
      });
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid OTP",
      });
    }

    console.log("[verifyUserOtpByAmbassador] OTP verified", { userId });
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
    console.log("[verifyUserOtpByAmbassador] Password setup email sent", {
      userId,
      email: user.email,
    });

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
    console.error("[verifyUserOtpByAmbassador] Error:", err?.message || err);
    console.error(
      "[verifyUserOtpByAmbassador] Stack:",
      err?.stack || "no-stack",
    );

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

exports.getMyWallet = async (req, res) => {
  try {
    const ambassadorId = req.user.id;
    console.log("[getMyWallet] Start", { ambassadorId });
    // remark: retrieve current ambassador wallet and latest history entries
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
        balance: wallet.availableBalance,
        availableBalance: wallet.availableBalance,
        reservedBalance: wallet.reservedBalance,
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
    // remark: build ambassador dashboard metrics and summary
    const ambassadorObjectId = new mongoose.Types.ObjectId(ambassadorId);

    const ambassador = await User.findById(ambassadorId);
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
      balance: wallet?.balance || 0, // Available balance for UI
      availableBalance: wallet?.availableBalance || 0,
      reservedBalance: wallet?.reservedBalance || 0,
      totalEarned: wallet?.totalEarned || 0,
      totalWithdrawn: wallet?.totalWithdrawn || 0,
      pendingWithdrawal: wallet?.reservedBalance || 0,
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
    let territories = [];

    if (ambassador.ambassadorType === "exclusive") {
      territories = await Territory.find({
        exclusiveAmbassador: ambassador._id,
      });
    }
    const cities = territories.map((t) => t.city);
    const territoryServices = await Service.find({
      city: {
        $in: cities,
      },
    }).select("_id owner city");

    const territoryServiceIds = territoryServices.map((service) => service._id);
    return res.json({
      isSuccess: true,

      dashboard: {
        ambassador: ambassadorInfo,
        ambassadorType: ambassador.ambassadorType,

        territories:
          ambassador.ambassadorType === "exclusive"
            ? territories.map((t) => ({
                id: t._id,
                city: t.city,
                country: t.country,
              }))
            : [],

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
    console.log("[walletHistory] Start", {
      ambassadorId,
      query: req.query,
    });
    // remark: return paginated ambassador wallet transaction history

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
    // remark: retrieve ambassador details by id

    const ambassador = await User.findById(id).populate(
      "parentAmbassador",
      "name email ambassadorCode",
    );

    if (!ambassador) {
      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    const wallet = await AmbassadorWallet.findOne({
      ambassador: ambassador._id,
    });
    const territories =
      ambassador.ambassadorType === "exclusive"
        ? await Territory.find({
            exclusiveAmbassador: ambassador._id,
          }).select("_id city country active kpiTarget")
        : [];
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

        territories,

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
    console.log("[getAmbassadorWalletHistory] Start", {
      ambassadorId,
      query: req.query,
    });
    // remark: return paginated wallet history for a specified ambassador

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
    // remark: compute analytics for a specific ambassador

    const ambassadorObjectId = new mongoose.Types.ObjectId(id);

    // AMBASSADOR DETAILS
    // ==========================

    const ambassador = await User.findById(id);

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
    let territories = [];

    if (ambassador.ambassadorType === "exclusive") {
      territories = await Territory.find({
        exclusiveAmbassador: ambassador._id,
      }).select("_id city country");
    }
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

    if (ambassador.ambassadorType === "exclusive" && territories.length > 0) {
      const cities = [...new Set(territories.map((t) => t.city))];

      const territoryServices = await Service.find({
        city: {
          $in: cities,
        },
      }).select("_id owner city");
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
        territories: territories.map((territory) => ({
          _id: territory._id,
          city: territory.city,
          country: territory.country,
        })),
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
  console.log("[withdrawAmount] Start", {
    body: req.body,
    userId: req.user?.id,
  });
  // remark: process a withdrawal request, create Stripe transfer/payout, and update wallet state
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
        refresh_url: "https://uat.betogetherapp.com/withdraw",
        return_url: "https://uat.betogetherapp.com/withdraw-success",
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
        refresh_url: "https://uat.betogetherapp.com/withdraw",
        return_url: "https://uat.betogetherapp.com/withdraw-success",
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
    // Sync Balance
    wallet.balance = wallet.availableBalance + wallet.reservedBalance;
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

          restoredWallet.balance =
            restoredWallet.availableBalance + restoredWallet.reservedBalance;

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

        wallet.balance = wallet.availableBalance + wallet.reservedBalance;

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
exports.acceptAmbassadorAgreement = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const userId = req.user.id;

    console.log("[acceptAmbassadorAgreement] Start", {
      userId,
      body: req.body,
    });

    // ====================================================
    // USER
    // ====================================================

    const user = await User.findById(userId).session(session);

    if (!user) {
      await session.abortTransaction();

      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    if (user.isAmbassador) {
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "User is already an ambassador.",
      });
    }

    // ====================================================
    // SAVE AGREEMENT ACCEPTANCE
    // ====================================================
const isRegisteredByAmbassador =
  !!user.registeredByAmbassador &&
  user.registeredAfterAmbassadorApproval &&
  !user.isAmbassador;
if (!isRegisteredByAmbassador) {
  user.ambassadorAgreementAccepted = true;
  user.ambassadorAgreementAcceptedAt = new Date();
}
    // ====================================================
    // CHECK SELF APPLICATION
    // ====================================================

    const selfApplication = await AmbassadorApplication.findOne({
      user: user._id,
      applicationType: "self",
      status: "pending",
    }).session(session);
const isRegisteredByAmbassador =
  !!user.registeredByAmbassador &&
  user.registeredAfterAmbassadorApproval &&
  !user.isAmbassador;
    // ====================================================
    // CHECK PENDING INVITATION
    // ====================================================

const pendingAssignment = await PendingAmbassadorAssignment.findOne({
  user: user._id,
})
  .sort({ createdAt: -1 })
  .session(session);
    // ====================================================
    // NOTHING FOUND
    // ====================================================

// =====================================
// NOTHING FOUND
// =====================================

if (
  !selfApplication &&
  !pendingAssignment &&
  !isRegisteredByAmbassador
) {
  await session.abortTransaction();

  return res.status(400).json({
    isSuccess: false,
    message: "No ambassador request or invitation found.",
  });
}

// =====================================
// INVITATION STATUS CHECK
// =====================================

if (!selfApplication && pendingAssignment) {
  if (pendingAssignment.status === "accepted") {
    await session.abortTransaction();

    return res.status(400).json({
      isSuccess: false,
      message:
        "You have already accepted this invitation and are now an ambassador.",
    });
  }

  if (pendingAssignment.status === "declined") {
    await session.abortTransaction();

    return res.status(400).json({
      isSuccess: false,
      message:
        "You have already declined this invitation. Please wait for a new invitation from the administrator.",
    });
  }

  if (pendingAssignment.status === "expired") {
    await session.abortTransaction();

    return res.status(400).json({
      isSuccess: false,
      message:
        "This invitation has expired. Please wait for a new invitation from the administrator.",
    });
  }
}
    // ====================================================
    // DETERMINE FLOW
    // ====================================================

    const isSelfApplication = !!selfApplication;

    const isAdminInvitation =
      pendingAssignment && pendingAssignment.assignmentSource === "admin";

    const isExclusiveInvitation =
      pendingAssignment && pendingAssignment.assignmentSource === "exclusive";

    // ====================================================
    // FINAL VALUES
    // ====================================================

    let finalAmbassadorType = null;

    let finalCommissionRate = null;

    let finalParentAmbassador = null;

    let finalTerritories = [];

    // ====================================================
    // SELF APPLICATION
    // ====================================================

    if (isSelfApplication) {
      // Admin will approve later
      finalAmbassadorType = null;
      finalCommissionRate = null;
    }

    // ====================================================
    // ADMIN INVITATION
    // ====================================================

    if (isAdminInvitation) {
      finalAmbassadorType = pendingAssignment.ambassadorType;

      finalCommissionRate = pendingAssignment.commissionRate;

      finalParentAmbassador = pendingAssignment.parentAmbassador || null;

      finalTerritories = pendingAssignment.territories || [];
    }

    // ====================================================
    // EXCLUSIVE INVITATION
    // ====================================================

    if (isExclusiveInvitation) {
      finalAmbassadorType = pendingAssignment.ambassadorType;

      finalCommissionRate = pendingAssignment.commissionRate;

      finalParentAmbassador = pendingAssignment.createdByUser;

      finalTerritories = pendingAssignment.territories || [];
    }

    // ====================================================
    // PART 2 STARTS HERE
    // ====================================================
    // ====================================================
    // AUTO APPROVAL (ADMIN / EXCLUSIVE)
    // ====================================================

    if (!isSelfApplication && !isRegisteredByAmbassador) {
      user.isAmbassador = true;

      user.ambassadorStatus = "approved";

      user.ambassadorApprovedAt = new Date();

      // No admin approval in invitation flow
      user.ambassadorApprovedBy = null;

      user.ambassadorReviewDueAt = new Date(
        Date.now() + 180 * 24 * 60 * 60 * 1000,
      );

      user.ambassadorType = finalAmbassadorType;

      user.commissionRate = finalCommissionRate;

      user.parentAmbassador = finalParentAmbassador;

      user.completedPaidServices = 0;

      if (!user.ambassadorCode) {
        user.ambassadorCode = `AMB${Date.now()}`;
      }

      // ====================================================
      // EXCLUSIVE TERRITORY ASSIGNMENT
      // ====================================================

      if (finalAmbassadorType === "exclusive" && finalTerritories.length > 0) {
        const territories = await Territory.find({
          _id: {
            $in: finalTerritories,
          },
        }).session(session);

        if (territories.length !== finalTerritories.length) {
          await session.abortTransaction();

          return res.status(404).json({
            isSuccess: false,
            message: "One or more territories not found.",
          });
        }

        for (const territory of territories) {
          if (
            territory.exclusiveAmbassador &&
            territory.exclusiveAmbassador.toString() !== user._id.toString()
          ) {
            await session.abortTransaction();

            return res.status(400).json({
              isSuccess: false,
              message: `${territory.city} is already assigned to another ambassador.`,
            });
          }
        }

        for (const territory of territories) {
          territory.exclusiveAmbassador = user._id;

          territory.assignedAt = new Date();

          territory.reviewDueAt = new Date(
            Date.now() + 180 * 24 * 60 * 60 * 1000,
          );

          await territory.save({ session });
        }
      }

      // ====================================================
      // CREATE WALLET
      // ====================================================

      const wallet = await AmbassadorWallet.findOne({
        ambassador: user._id,
      }).session(session);

      if (!wallet) {
        await AmbassadorWallet.create(
          [
            {
              ambassador: user._id,
            },
          ],
          {
            session,
          },
        );
      }
    }

    // ====================================================
    // SAVE USER
    // ====================================================

    await user.save({ session });

    // ====================================================
    // PART 3 STARTS HERE
    // ====================================================
    // ====================================================
    // UPDATE APPLICATION / ASSIGNMENT
    // ====================================================

    if (isSelfApplication) {
      // User has only accepted the agreement.
      // Admin will approve/reject later.
      //  await selfApplication.save({ session });
    } else if (isRegisteredByAmbassador) {
      // Handle the case where the user was registered by an ambassador
      user.ambassadorUserAgreementAccepted = true;

  user.ambassadorUserAgreementAcceptedAt = new Date();
    } else {
      pendingAssignment.status = "accepted";

      pendingAssignment.acceptedAt = new Date();

      await pendingAssignment.save({ session });

      await AmbassadorApplication.create(
        [
          {
            user: user._id,

            applicationType:
              pendingAssignment.assignmentSource === "admin"
                ? "admin_invitation"
                : "exclusive_invitation",

            createdByAdmin: pendingAssignment.createdByAdmin,

            createdByUser: pendingAssignment.createdByUser,

            sourceAssignment: pendingAssignment._id,

            status: "approved",
            acceptedAgreement: true,
          },
        ],
        { session },
      );
    }

    // ====================================================
    // COMMIT TRANSACTION
    // ====================================================

    await session.commitTransaction();

    // ====================================================
    // SEND NOTIFICATION
    // ====================================================

    try {
if (!isSelfApplication && !isRegisteredByAmbassador) {
        await sendAmbassadorApprovedNotification(user);
      }
    } catch (err) {
      console.error(
        "[acceptAmbassadorAgreement] Notification Error",
        err.message,
      );
    }

    // ====================================================
    // RESPONSE
    // ====================================================

    console.log("[acceptAmbassadorAgreement] Completed", {
      userId: user._id,
      isAmbassador: user.isAmbassador,
      ambassadorType: user.ambassadorType,
      ambassadorStatus: user.ambassadorStatus,
    });

    return res.json({
      isSuccess: true,

message: isRegisteredByAmbassador
  ? "Agreement accepted successfully."
  : isSelfApplication
  ? "Agreement accepted successfully. Your application is pending admin approval."
  : "Invitation accepted successfully. You are now an ambassador.",
      user: {
        _id: user._id,

        name: user.name,

        isAmbassador: user.isAmbassador,

        ambassadorStatus: user.ambassadorStatus,

        ambassadorType: user.ambassadorType,

        commissionRate: user.commissionRate,

        ambassadorCode: user.ambassadorCode,

        parentAmbassador: user.parentAmbassador,

        territories:
          user.ambassadorType === "exclusive" ? finalTerritories : [],
      },
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("[acceptAmbassadorAgreement]", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};
exports.declineAmbassadorInvitation = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const userId = req.user.id;

    // =====================================
    // FIND PENDING INVITATION
    // =====================================

const assignment = await PendingAmbassadorAssignment.findOne({
  user: userId,
})
  .sort({ createdAt: -1 })
  .session(session);
    if (!assignment) {
      await session.abortTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "No pending invitation found.",
      });
    }
    if (assignment.status === "declined") {
  await session.abortTransaction();

  return res.status(400).json({
    isSuccess: false,
    message:
      "You have already declined this invitation. Please wait for a new invitation from the administrator.",
  });
}

if (assignment.status === "accepted") {
  await session.abortTransaction();

  return res.status(400).json({
    isSuccess: false,
    message:
      "You have already accepted this invitation and are now an ambassador.",
  });
}

if (assignment.status === "expired") {
  await session.abortTransaction();

  return res.status(400).json({
    isSuccess: false,
    message:
      "This invitation has expired. Please wait for a new invitation from the administrator.",
  });
}

if (assignment.status !== "pending") {
  await session.abortTransaction();

  return res.status(400).json({
    isSuccess: false,
    message: "No active invitation found.",
  });
}

    // =====================================
    // CHECK INVITATION EXPIRY
    // =====================================

    if (assignment.expiresAt && assignment.expiresAt < new Date()) {
      assignment.status = "expired";
      await assignment.save({ session });

      await session.commitTransaction();

      return res.status(400).json({
        isSuccess: false,
        message: "Invitation has already expired.",
      });
    }

    // =====================================
    // DECLINE INVITATION
    // =====================================

    assignment.status = "declined";

    if (!assignment.declinedAt) {
      assignment.declinedAt = new Date();
    }

    await assignment.save({ session });

    // =====================================
    // COMMIT
    // =====================================

    await session.commitTransaction();

    // =====================================
    // RESPONSE
    // =====================================

    return res.json({
      isSuccess: true,
      message: "Invitation declined successfully.",
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("[declineAmbassadorInvitation]", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
};
// exports.updateAmbassador = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const { commissionRate, territoryIds } = req.body;

//     console.log("[updateAmbassador] Request", {
//       userId,
//       commissionRate,
//       territoryIds,
//     });

//     // =====================================
//     // GET USER
//     // =====================================

//     const user = await User.findById(userId);

//     if (!user) {
//       return res.status(404).json({
//         isSuccess: false,
//         message: "Ambassador not found",
//       });
//     }

//     if (!user.isAmbassador) {
//       return res.status(400).json({
//         isSuccess: false,
//         message: "User is not an ambassador",
//       });
//     }

//     if (user.ambassadorStatus !== "approved") {
//       return res.status(400).json({
//         isSuccess: false,
//         message: "Only approved ambassadors can be updated",
//       });
//     }

//     // =====================================
//     // VALIDATE COMMISSION
//     // =====================================

//     if (
//       commissionRate === undefined ||
//       commissionRate === null ||
//       isNaN(commissionRate)
//     ) {
//       return res.status(400).json({
//         isSuccess: false,
//         message: "commissionRate is required",
//       });
//     }

//     if (
//       Number(commissionRate) < 0 ||
//       Number(commissionRate) > 12
//     ) {
//       return res.status(400).json({
//         isSuccess: false,
//         message: "commissionRate must be between 0 and 12",
//       });
//     }

//     user.commissionRate = Number(commissionRate);

//     // =====================================
//     // STANDARD AMBASSADOR
//     // =====================================

//     if (user.ambassadorType === "standard") {
//       await user.save();

//       return res.json({
//         isSuccess: true,
//         message: "Standard ambassador updated successfully",
//         user,
//       });
//     }

//     // =====================================
//     // EXCLUSIVE AMBASSADOR
//     // =====================================

//     if (user.ambassadorType === "exclusive") {

//       if (
//         !territoryIds ||
//         !Array.isArray(territoryIds) ||
//         territoryIds.length === 0
//       ) {
//         return res.status(400).json({
//           isSuccess: false,
//           message: "territoryIds is required",
//         });
//       }

//       const uniqueTerritoryIds = [...new Set(territoryIds)];

//       const territories = await Territory.find({
//         _id: {
//           $in: uniqueTerritoryIds,
//         },
//         active: true,
//       });

//       if (territories.length !== uniqueTerritoryIds.length) {
//         return res.status(404).json({
//           isSuccess: false,
//           message: "One or more territories not found",
//         });
//       }

//       // =====================================
//       // CHECK TERRITORY ALREADY ASSIGNED
//       // =====================================

//       for (const territory of territories) {
//         if (
//           territory.exclusiveAmbassador &&
//           territory.exclusiveAmbassador.toString() !== user._id.toString()
//         ) {
//           return res.status(400).json({
//             isSuccess: false,
//             message: `${territory.city}, ${territory.country} is already assigned to another ambassador`,
//           });
//         }
//       }

//       // =====================================
//       // REMOVE OLD TERRITORIES
//       // =====================================

//       await Territory.updateMany(
//         {
//           exclusiveAmbassador: user._id,
//         },
//         {
//           $set: {
//             exclusiveAmbassador: null,
//             assignedAt: null,
//             reviewDueAt: null,
//           },
//         }
//       );

//       // =====================================
//       // ASSIGN NEW TERRITORIES
//       // =====================================

//       await Territory.updateMany(
//         {
//           _id: {
//             $in: uniqueTerritoryIds,
//           },
//         },
//         {
//           $set: {
//             exclusiveAmbassador: user._id,
//             assignedAt: new Date(),
//             reviewDueAt: new Date(
//               Date.now() + 180 * 24 * 60 * 60 * 1000
//             ),
//           },
//         }
//       );

//       await user.save();

//       const updatedTerritories = await Territory.find({
//         exclusiveAmbassador: user._id,
//       }).select("city country");

//       return res.json({
//         isSuccess: true,
//         message: "Exclusive ambassador updated successfully",
//         user,
//         territories: updatedTerritories,
//       });
//     }

//     // =====================================
//     // INVALID TYPE
//     // =====================================

//     return res.status(400).json({
//       isSuccess: false,
//       message: "Invalid ambassador type",
//     });

//   } catch (err) {
//     console.error("[updateAmbassador]", err);

//     return res.status(500).json({
//       isSuccess: false,
//       message: err.message,
//     });
//   }
// };
exports.handlePayoutCreated = async (payout) => {
  try {
    console.log("[handlePayoutCreated] Start", {
      payoutId: payout?.id,
      metadata: payout?.metadata,
    });
    // remark: handle Stripe payout created webhook event and update withdrawal record

    const withdrawalId = payout.metadata?.withdrawalId;

    if (!withdrawalId) {
      console.log("[handlePayoutCreated] Withdrawal Id Missing", {
        payoutId: payout?.id,
      });
      return;
    }

    const withdrawal = await AmbassadorWithdrawal.findById(withdrawalId);
    console.log("[handlePayoutCreated] Withdrawal loaded", {
      withdrawalId,
      status: withdrawal?.status,
      stripePayoutId: withdrawal?.stripePayoutId,
      finalAmount: withdrawal?.finalAmount,
    });

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
    // remark: handle Stripe payout status updates and reflect them in withdrawal records

    const withdrawalId = payout.metadata?.withdrawalId;

    if (!withdrawalId) {
      console.log("[handlePayoutUpdated] Withdrawal Id Missing", {
        payoutId: payout?.id,
      });
      return;
    }

    const withdrawal = await AmbassadorWithdrawal.findById(withdrawalId);
    console.log("[handlePayoutUpdated] Withdrawal loaded", {
      withdrawalId,
      currentStatus: withdrawal?.status,
      stripePayoutId: withdrawal?.stripePayoutId,
      finalAmount: withdrawal?.finalAmount,
    });

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

  console.log("[handlePayoutPaid] Start", { payoutId: payout?.id });
  // remark: finalize payout and update ambassador wallet history
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
    console.log("[handlePayoutPaid] Withdrawal loaded", {
      withdrawalId,
      currentStatus: withdrawal?.status,
      stripePayoutId: withdrawal?.stripePayoutId,
      finalAmount: withdrawal?.finalAmount,
    });

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
    // Sync Balance
    wallet.balance = wallet.availableBalance + wallet.reservedBalance;
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
    // remark: handle failed Stripe payout and restore ambassador wallet/reservation state
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
    console.log("[handlePayoutFailed] Withdrawal loaded", {
      withdrawalId,
      currentStatus: withdrawal?.status,
      stripePayoutId: withdrawal?.stripePayoutId,
      finalAmount: withdrawal?.finalAmount,
    });

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

    // Sync Balance
    wallet.balance = wallet.availableBalance + wallet.reservedBalance;

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
