const User = require("../model/User");
const ReferralVisit =
  require("../model/ReferralVisit");

exports.openReferralLink =
  async (req, res) => {

    try {

      const { code } = req.params;

      const deviceId =
        req.query.deviceId;

      if (!deviceId) {

        return res.send(
          "deviceId missing"
        );

      }

      await ReferralVisit.create({

        referralCode: code,

        deviceId,

        ipAddress: req.ip,

      });

      return res.redirect(
        "https://play.google.com/store/apps/details?id=com.yourapp"
      );

    } catch (err) {

      return res.status(500).json({
        message: err.message,
      });

    }

};