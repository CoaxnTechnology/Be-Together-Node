const AdminWalletConfig = require("../model/AdminWalletConfig");

// ======================
// ADD CONFIG
// ======================

exports.createWalletConfig = async (req, res) => {
  try {
    const existing = await AdminWalletConfig.findOne();

    if (existing) {
      return res.status(400).json({
        isSuccess: false,
        message: "Wallet config already exists",
      });
    }

    const config = await AdminWalletConfig.create({
      inviterBonus: req.body.inviterBonus,

      invitedBonus: req.body.invitedBonus,

      maxWalletUsagePercent: req.body.maxWalletUsagePercent,

      coinToCurrencyValue: req.body.coinToCurrencyValue,

      currency: req.body.currency,
    });

    return res.status(201).json({
      isSuccess: true,
      message: "Wallet config created",
      data: config,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// ======================
// GET CONFIG
// ======================

exports.getWalletConfig = async (req, res) => {
  try {
    const config = await AdminWalletConfig.findOne();

    return res.json({
      isSuccess: true,
      data: config || {},
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// ======================
// EDIT CONFIG
// ======================

exports.updateWalletConfig = async (req, res) => {
  try {
    const { id } = req.params;

    const config = await AdminWalletConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        isSuccess: false,
        message: "Wallet config not found",
      });
    }

    if (req.body.inviterBonus !== undefined) {
      config.inviterBonus = req.body.inviterBonus;
    }

    if (req.body.invitedBonus !== undefined) {
      config.invitedBonus = req.body.invitedBonus;
    }

    if (req.body.maxWalletUsagePercent !== undefined) {
      config.maxWalletUsagePercent = req.body.maxWalletUsagePercent;
    }

    if (req.body.coinToCurrencyValue !== undefined) {
      config.coinToCurrencyValue = req.body.coinToCurrencyValue;
    }

    if (req.body.currency !== undefined) {
      config.currency = req.body.currency;
    }

    await config.save();

    return res.json({
      isSuccess: true,
      message: "Wallet config updated",
      data: config,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// ======================
// DELETE CONFIG
// ======================

exports.deleteWalletConfig = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await AdminWalletConfig.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        isSuccess: false,
        message: "Wallet config not found",
      });
    }

    return res.json({
      isSuccess: true,
      message: "Wallet config deleted",
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
