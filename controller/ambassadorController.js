const User = require("../model/User");
const AmbassadorApplication = require("../model/AmbassadorApplication");

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

    user.isAmbassador = true;

    user.ambassadorStatus = "approved";

    user.ambassadorApprovedAt = new Date();

    user.ambassadorApprovedBy = req.admin.id;

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

    if (!user.ambassadorCode) {
      user.ambassadorCode = `AMB${Date.now()}`;
    }

    await user.save();

    return res.json({
      isSuccess: true,
      message: "User promoted to Ambassador successfully",
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

    await user.save();

    return res.json({
      isSuccess: true,
      message: "Ambassador removed successfully",
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
