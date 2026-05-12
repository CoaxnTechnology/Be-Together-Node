const Wallet =
  require("../model/Wallet");

const WalletHistory =
  require("../model/WalletHistory");

exports.getWallet =
  async (req, res) => {

    try {

      const { userId } =
        req.params;

      const wallet =
        await Wallet.findOne({
          user: userId,
        });

      const history =
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

      return res.json({

        isSuccess: true,

        wallet,

        history,

      });

    } catch (err) {

      return res.status(500).json({
        message: err.message,
      });

    }

};