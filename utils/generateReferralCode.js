const User = require("../model/User");

module.exports = async function generateReferralCode(name) {

  let referralCode;
  let exists = true;

  while (exists) {

    const cleanName =
      (name || "USER")
      .replace(/\s/g, "")
      .substring(0, 4)
      .toUpperCase();

    const random =
      Math.floor(
        1000 + Math.random() * 9000
      );

    referralCode =
      `${cleanName}${random}`;

    exists = await User.findOne({
      referralCode,
    });

  }

  return referralCode;

};