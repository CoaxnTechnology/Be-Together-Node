const User = require("../model/User");

module.exports = async function checkServiceRestriction(req, res, next) {
  try {
    const userId = req.body.userId; // provider id

    if (!userId) {
      return res.status(400).json({
        isSuccess: false,
        message: "userId is required",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        isSuccess: false,
        message: "User not found",
      });
    }

    // ⛔ 1. Check existing restriction
    if (user.restrictionOnNewServiceUntil && user.restrictionOnNewServiceUntil > new Date()) {
      return res.status(403).json({
        isSuccess: false,
        message: "You cannot create service now. You are restricted for low performance.",
        restrictedUntil: user.restrictionOnNewServiceUntil,
      });
    }

    // ⛔ 2. Check current score
    if ((user.performancePoints || 0) < 70) {
      user.restrictionOnNewServiceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await user.save();

      return res.status(403).json({
        isSuccess: false,
        message: "Your score is low. You are blocked for 24 hours.",
        restrictedUntil: user.restrictionOnNewServiceUntil,
      });
    }

    // 👍 All good → Continue API
    req.user = user;
    next();
    
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
