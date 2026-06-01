const User = require("../model/User");

const Service = require("../model/Service");

const Booking = require("../model/Booking");

const Payment = require("../model/Payment");

const Wallet = require("../model/Wallet");

const WalletHistory = require("../model/WalletHistory");

const Review = require("../model/review");

const ReferralTracking = require("../model/ReferralTracking");

const ReferralHistory = require("../model/ReferralHistory");

const AccountDeleteBackup = require("../model/AccountDeleteBackup");

// =======================================
// DELETE ACCOUNT
// =======================================
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    // ===========================
    // FIND USER
    // ===========================
    const user = await User.findById(userId).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ===========================
    // CHECK ACTIVE SERVICE
    // ===========================
    const activeService = await Service.findOne({
      owner: userId,
      $or: [
        { deleteRequestStatus: null },
        { deleteRequestStatus: "rejected" },
        { deleteRequestStatus: "pending" },
      ],
    });

    if (activeService) {
      return res.status(400).json({
        success: false,
        type: "ACTIVE_SERVICE",
        message:
          "Please delete or deactivate your active services before deleting account",
      });
    }

    // ===========================
    // CHECK ACTIVE BOOKINGS
    // ===========================
    const activeBooking = await Booking.findOne({
      $or: [{ customer: userId }, { provider: userId }],
      status: {
        $in: ["pending_payment", "booked", "started"],
      },
    });

    if (activeBooking) {
      return res.status(400).json({
        success: false,
        type: "ACTIVE_BOOKING",
        message:
          "Please complete or cancel active bookings before deleting your account",
      });
    }

    // ===========================
    // FETCH USER SERVICES
    // ===========================
    const services = await Service.find({
      owner: userId,
    })
      .populate("owner", "name email mobile")
      .populate("category", "name")
      .lean();

    // ===========================
    // FETCH BOOKINGS
    // ===========================
    const bookings = await Booking.find({
      $or: [{ customer: userId }, { provider: userId }],
    })
      .populate("customer", "name email mobile")
      .populate("provider", "name email mobile")
      .populate("service", "title price currency")
      .populate("paymentId", "amount currency status paymentIntentId")
      .lean();

    // ===========================
    // FETCH PAYMENTS
    // ===========================
    const payments = await Payment.find({
      $or: [{ user: userId }, { provider: userId }],
    })
      .populate("user", "name email mobile")
      .populate("provider", "name email mobile")
      .populate("service", "title price currency")
      .lean();

    console.log({
      services: services.length,
      bookings: bookings.length,
      payments: payments.length,
    });

    // ===========================
    // SAVE BACKUP
    // ===========================
    const backup = await AccountDeleteBackup.create({
      deletedUserId: userId,

      userDetails: user,

      services,

      bookings,

      payments,

      summary: {
        totalServices: services.length,
        totalBookings: bookings.length,
        totalPayments: payments.length,
      },

      generatedAt: new Date(),
    });

    console.log("Backup saved:", backup._id);

    // ===========================
    // DELETE USER RELATED DATA
    // ===========================
    await Promise.all([
      Wallet.deleteOne({ user: userId }),

      WalletHistory.deleteMany({
        user: userId,
      }),

      Review.deleteMany({
        $or: [{ user: userId }, { provider: userId }],
      }),

      ReferralTracking.deleteMany({
        $or: [{ referrer: userId }, { referredUser: userId }],
      }),

      ReferralHistory.deleteMany({
        $or: [{ user: userId }, { receiver: userId }],
      }),

      Payment.deleteMany({
        $or: [{ user: userId }, { provider: userId }],
      }),

      Booking.deleteMany({
        $or: [{ customer: userId }, { provider: userId }],
      }),

      Service.deleteMany({
        owner: userId,
      }),
    ]);

    // ===========================
    // DELETE USER
    // ===========================
    await User.findByIdAndDelete(userId);

    // ===========================
    // RESPONSE
    // ===========================
    return res.status(200).json({
      success: true,
      message: "Account deleted successfully",

      backupId: backup._id,

      counts: {
        services: services.length,
        bookings: bookings.length,
        payments: payments.length,
      },
    });
  } catch (error) {
    console.error("Delete account error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
exports.getDeletedUsers = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;

    const limit = Number(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const total = await AccountDeleteBackup.countDocuments();

    const deletedUsers = await AccountDeleteBackup.find()
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .select({
        deletedUserId: 1,
        userDetails: 1,
        summary: 1,
        generatedAt: 1,
      })
      .lean();

    const formatted = deletedUsers.map((item) => ({
      backupId: item._id,

      deletedUserId: item.deletedUserId,

      name: item?.userDetails?.name || null,

      email: item?.userDetails?.email || null,

      mobile: item?.userDetails?.mobile || null,

      totalServices: item?.summary?.totalServices || 0,

      totalBookings: item?.summary?.totalBookings || 0,

      totalPayments: item?.summary?.totalPayments || 0,

      deletedAt: item.generatedAt,
    }));

    return res.status(200).json({
      success: true,

      total,

      page,

      limit,

      data: formatted,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,

      message: error.message,
    });
  }
};
exports.getDeletedUserById = async (req, res) => {
  try {
    const { backupId } = req.params;

    const data = await AccountDeleteBackup.findById(backupId).lean();

    if (!data) {
      return res.status(404).json({
        success: false,

        message: "Deleted user not found",
      });
    }

    return res.status(200).json({
      success: true,

      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,

      message: error.message,
    });
  }
};
