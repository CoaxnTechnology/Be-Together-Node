const User = require("../model/User");
const Wallet = require("../model/Wallet");
const WalletHistory = require("../model/WalletHistory");
const AdminWalletConfig = require("../model/AdminWalletConfig");

const processReferralReward = async (user) => {
  try {
    // ======================
    // SAFETY CHECKS
    // ======================

    if (!user) {
      console.log("❌ User missing");
      return;
    }

    if (!user.referredBy) {
      console.log("❌ No referredBy found");
      return;
    }

    // reward already processed
    if (user.referralRewardProcessed) {
      console.log(
        "⚠️ Referral reward already processed"
      );
      return;
    }

    // ======================
    // ADMIN CONFIG
    // ======================

    const config =
      await AdminWalletConfig.findOne();

    if (!config) {
      console.log(
        "❌ Admin wallet config missing"
      );
      return;
    }

    const inviterReward =
      Number(
        config.inviterReward
      ) || 0;

    const invitedReward =
      Number(
        config.invitedReward
      ) || 0;

    // safety
    if (
      inviterReward <= 0 &&
      invitedReward <= 0
    ) {
      console.log(
        "❌ Invalid reward config"
      );
      return;
    }

    // ======================
    // REFERRAL USER
    // ======================

    const inviterUser =
      await User.findById(
        user.referredBy
      );

    if (!inviterUser) {
      console.log(
        "❌ Inviter user not found"
      );
      return;
    }

    // ======================
    // SELF REFERRAL BLOCK
    // ======================

    if (
      String(inviterUser._id) ===
      String(user._id)
    ) {
      console.log(
        "❌ Self referral blocked"
      );
      return;
    }

    // ======================
    // INVITER WALLET
    // ======================

    let inviterWallet =
      await Wallet.findOne({
        user:
          inviterUser._id,
      });

    if (!inviterWallet) {
      inviterWallet =
        await Wallet.create({
          user:
            inviterUser._id,

          points: 0,

          totalEarned: 0,

          totalSpent: 0,
        });
    }

    // ======================
    // INVITED WALLET
    // ======================

    let invitedWallet =
      await Wallet.findOne({
        user: user._id,
      });

    if (!invitedWallet) {
      invitedWallet =
        await Wallet.create({
          user: user._id,

          points: 0,

          totalEarned: 0,

          totalSpent: 0,
        });
    }

    // ======================
    // CREDIT INVITER
    // ======================

    if (inviterReward > 0) {
      inviterWallet.points +=
        inviterReward;

      inviterWallet.totalEarned +=
        inviterReward;

      await inviterWallet.save();

      await WalletHistory.create({
        user:
          inviterUser._id,

        points:
          inviterReward,

        transactionType:
          "credit",

        type:
          "referral_inviter_bonus",

        referralUser:
          user._id,

        note:
          "Referral signup reward (inviter)",
      });
    }

    // ======================
    // CREDIT INVITED USER
    // ======================

    if (invitedReward > 0) {
      invitedWallet.points +=
        invitedReward;

      invitedWallet.totalEarned +=
        invitedReward;

      await invitedWallet.save();

      await WalletHistory.create({
        user: user._id,

        points:
          invitedReward,

        transactionType:
          "credit",

        type:
          "referral_invited_bonus",

        referralUser:
          inviterUser._id,

        note:
          "Referral signup reward (invited)",
      });
    }

    // ======================
    // USER STATS
    // ======================

    inviterUser.totalReferralUsers += 1;

    inviterUser.totalReferralEarned +=
      inviterReward;

    await inviterUser.save();

    // ======================
    // MARK SUCCESS
    // ======================

    user.referralRewardProcessed =
      true;

    await user.save();

    console.log(
      "✅ Referral reward success"
    );
  } catch (err) {
    console.log(
      "❌ Referral reward error:",
      err.message
    );
  }
};

module.exports =
  processReferralReward;