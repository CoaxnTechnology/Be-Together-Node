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
    console.log("========== DELETE ACCOUNT START ==========");

    const userId = req.user.id;
    console.log("User ID:", userId);

    // ===========================
    // FIND USER
    // ===========================
    console.log("Finding user...");

    const user = await User.findById(userId).lean();

    console.log("User found:", !!user);

    if (!user) {
      console.log("User not found");

      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("User Name:", user.name);
    console.log("User Email:", user.email);

    // ===========================
    // CHECK ACTIVE SERVICE
    // ===========================
    console.log("Checking active services...");

    const activeService = await Service.findOne({
      owner: userId,
      $or: [
        { deleteRequestStatus: null },
        { deleteRequestStatus: "rejected" },
        { deleteRequestStatus: "pending" },
      ],
    });

    console.log("Active Service Exists:", !!activeService);

    if (activeService) {
      console.log("Active service ID:", activeService._id);

      return res.status(400).json({
        success: false,
        type: "ACTIVE_SERVICE",
        message:
          "Please delete or deactivate your active services before deleting account",
      });
    }

    console.log("No active services.");

    // ===========================
    // CHECK ACTIVE BOOKINGS
    // ===========================
    console.log("Checking active bookings...");

    const activeBooking = await Booking.findOne({
      $or: [{ customer: userId }, { provider: userId }],
      status: {
        $in: ["pending_payment", "booked", "started"],
      },
    });

    console.log("Active Booking Exists:", !!activeBooking);

    if (activeBooking) {
      console.log("Active Booking ID:", activeBooking._id);

      return res.status(400).json({
        success: false,
        type: "ACTIVE_BOOKING",
        message:
          "Please complete or cancel active bookings before deleting your account",
      });
    }

    console.log("No active bookings.");

    // ===========================
    // FETCH USER SERVICES
    // ===========================
    console.log("Fetching user services...");

    const services = await Service.find({
      owner: userId,
    })
      .populate("owner", "name email mobile")
      .populate("category", "name")
      .lean();

    console.log("Services fetched:", services.length);

    // ===========================
    // FETCH BOOKINGS
    // ===========================
    console.log("Fetching bookings...");

    const bookings = await Booking.find({
      $or: [{ customer: userId }, { provider: userId }],
    })
      .populate("customer", "name email mobile")
      .populate("provider", "name email mobile")
      .populate("service", "title price currency")
      .populate("paymentId", "amount currency status paymentIntentId")
      .lean();

    console.log("Bookings fetched:", bookings.length);

    // ===========================
    // FETCH PAYMENTS
    // ===========================
    console.log("Fetching payments...");

    const payments = await Payment.find({
      $or: [{ user: userId }, { provider: userId }],
    })
      .populate("user", "name email mobile")
      .populate("provider", "name email mobile")
      .populate("service", "title price currency")
      .lean();

    console.log("Payments fetched:", payments.length);

    console.log("Summary:", {
      services: services.length,
      bookings: bookings.length,
      payments: payments.length,
    });

    // ===========================
    // SAVE BACKUP
    // ===========================
    console.log("Creating backup...");

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

    console.log("Backup created successfully.");
    console.log("Backup ID:", backup._id);

    // ===========================
    // DELETE USER RELATED DATA
    // ===========================
    console.log("Deleting Wallet...");
    await Wallet.deleteOne({ user: userId });
    console.log("Wallet deleted.");

    console.log("Deleting Wallet History...");
    const walletHistoryResult = await WalletHistory.deleteMany({
      user: userId,
    });
    console.log("Wallet History deleted:", walletHistoryResult.deletedCount);

    console.log("Deleting Reviews...");
    const reviewResult = await Review.deleteMany({
      $or: [{ user: userId }, { provider: userId }],
    });
    console.log("Reviews deleted:", reviewResult.deletedCount);

    console.log("Deleting Referral Tracking...");
    const referralTrackingResult = await ReferralTracking.deleteMany({
      $or: [{ referrer: userId }, { referredUser: userId }],
    });
    console.log(
      "Referral Tracking deleted:",
      referralTrackingResult.deletedCount
    );

    console.log("Deleting Referral History...");
    const referralHistoryResult = await ReferralHistory.deleteMany({
      $or: [{ user: userId }, { receiver: userId }],
    });
    console.log(
      "Referral History deleted:",
      referralHistoryResult.deletedCount
    );

    console.log("Deleting Payments...");
    const paymentResult = await Payment.deleteMany({
      $or: [{ user: userId }, { provider: userId }],
    });
    console.log("Payments deleted:", paymentResult.deletedCount);

    console.log("Deleting Bookings...");
    const bookingResult = await Booking.deleteMany({
      $or: [{ customer: userId }, { provider: userId }],
    });
    console.log("Bookings deleted:", bookingResult.deletedCount);

    console.log("Deleting Services...");
    const serviceResult = await Service.deleteMany({
      owner: userId,
    });
    console.log("Services deleted:", serviceResult.deletedCount);

    // ===========================
    // DELETE USER
    // ===========================
    console.log("Deleting User...");

    await User.findByIdAndDelete(userId);

    console.log("User deleted successfully.");

    console.log("========== DELETE ACCOUNT SUCCESS ==========");

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
    console.error("========== DELETE ACCOUNT ERROR ==========");
    console.error(error);
    console.error("Stack:", error.stack);

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
