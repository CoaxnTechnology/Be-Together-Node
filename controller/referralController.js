const User = require("../model/User");

const Wallet = require("../model/Wallet");

const WalletHistory = require("../model/WalletHistory");

exports.getReferralDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    // ========================
    // WALLET
    // ========================

    const wallet = await Wallet.findOne({
      user: userId,
    });

    // ========================
    // REFERRED USERS
    // ========================

    const referredUsers = await User.find({
      referredBy: userId,
    })

      .select("name email profile_image created_at")

      .sort({
        created_at: -1,
      });

    // ========================
    // REFERRAL STATUS
    // ========================

    const referralUsers = await Promise.all(
      referredUsers.map(async (refUser) => {
        const history = await WalletHistory.findOne({
          user: userId,

          referralUser: refUser._id,

          type: "referral_inviter_bonus",
        });

        return {
          user: {
            id: refUser._id,

            name: refUser.name,

            email: refUser.email,

            profile_image: refUser.profile_image,

            joinedAt: refUser.created_at,
          },

          earnedPoints: history?.points || 0,

          status: history?.points > 0 ? "rewarded" : "pending",

          message:
            history?.points > 0
              ? `${refUser.name} joined using your referral and you earned ${history.points} coins`
              : `${refUser.name} joined but reward pending`,
        };
      }),
    );

    // ========================
    // WALLET HISTORY
    // ========================

    const walletHistory = await WalletHistory.find({
      user: userId,
    })

      .populate("referralUser", "name email profile_image")

      .sort({
        created_at: -1,
      });

    // ========================
    // STATS
    // ========================

    const totalReferrals = referredUsers.length;

    const completedReferrals = referralUsers.filter(
      (r) => r.earnedPoints > 0,
    ).length;

    const pendingReferrals = referralUsers.filter(
      (r) => r.earnedPoints === 0,
    ).length;

    return res.json({
      IsSucces: true,

      stats: {
        totalReferrals,

        completedReferrals,

        pendingReferrals,
      },

      wallet: {
        points: wallet?.points || 0,

        totalEarned: wallet?.totalEarned || 0,

        totalSpent: wallet?.totalSpent || 0,
      },

      referrals: referralUsers,

      walletHistory,
    });
  } catch (err) {
    return res.status(500).json({
      IsSucces: false,

      message: err.message,
    });
  }
};
