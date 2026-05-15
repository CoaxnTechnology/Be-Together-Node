const User =
require("../model/User");

const Wallet =
require("../model/Wallet");

const WalletHistory =
require("../model/WalletHistory");

exports.getReferralDashboard =
async (req, res) => {

  try {

    const userId =
      req.user.id;

    // ========================
    // WALLET
    // ========================

    const wallet =
      await Wallet.findOne({

        user: userId,

      });

    // ========================
    // REFERRED USERS
    // ========================

    const referredUsers =
      await User.find({

        referredBy: userId,

      })

      .select(
        "name email profile_image created_at"
      )

      .sort({
        created_at: -1,
      });

    // ========================
    // REFERRAL STATUS
    // ========================

    const referralUsers =
      await Promise.all(

        referredUsers.map(
          async (refUser) => {

            const history =
              await WalletHistory.find({

                user: userId,

                referralUser:
                  refUser._id,

              });

            let bookingBonus = 0;

            let serviceBonus = 0;

            history.forEach((h) => {

              if (
                h.type ===
                "referral_booking_bonus"
              ) {

                bookingBonus +=
                  h.points;

              }

              if (
                h.type ===
                "referral_service_bonus"
              ) {

                serviceBonus +=
                  h.points;

              }

            });

            return {

              user: refUser,

              bookingBonus,

              serviceBonus,

              totalBonus:
                bookingBonus +
                serviceBonus,

              hasCompletedBooking:
                bookingBonus > 0,

              hasCreatedService:
                serviceBonus > 0,

            };

          }
        )

      );

    // ========================
    // WALLET HISTORY
    // ========================

    const walletHistory =
      await WalletHistory.find({

        user: userId,

      })

      .populate(
        "referralUser",
        "name email profile_image"
      )

      .sort({
        created_at: -1,
      });

    // ========================
    // STATS
    // ========================

    const totalReferrals =
      referredUsers.length;

    const completedReferrals =
      referralUsers.filter(

        (r) =>
          r.totalBonus > 0

      ).length;

    const pendingReferrals =
      referralUsers.filter(

        (r) =>
          r.totalBonus === 0

      ).length;

    return res.json({

      IsSucces: true,

      stats: {

        totalReferrals,

        completedReferrals,

        pendingReferrals,

      },

      wallet: {

        points:
          wallet?.points || 0,

        totalEarned:
          wallet?.totalEarned || 0,

        totalSpent:
          wallet?.totalSpent || 0,

      },

      referrals:
        referralUsers,

      walletHistory,

    });

  } catch (err) {

    return res.status(500).json({

      IsSucces: false,

      message:
        err.message,

    });

  }

};