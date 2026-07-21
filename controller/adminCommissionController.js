const CommissionSetting = require("../model/CommissionSetting");

exports.getCommission = async (req, res) => {
  try {
    let setting = await CommissionSetting.findOne();

    if (!setting) {
      setting = await CommissionSetting.create({
        providerCommissionPercentage: 8,
        customerCommissionPercentage: 4,
      });
    }

    res.status(200).json({
      providerCommissionPercentage: setting.providerCommissionPercentage || 8,

      customerCommissionPercentage: setting.customerCommissionPercentage || 4,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

exports.updateCommission = async (req, res) => {
  try {
    const {
      providerCommissionPercentage,
      customerCommissionPercentage,
      adminId,
    } = req.body;

    if (
      providerCommissionPercentage < 0 ||
      providerCommissionPercentage > 100
    ) {
      return res.status(400).json({
        message: "Invalid provider commission value",
      });
    }

    if (
      customerCommissionPercentage < 0 ||
      customerCommissionPercentage > 100
    ) {
      return res.status(400).json({
        message: "Invalid customer commission value",
      });
    }

    const totalCommission =
      Number(providerCommissionPercentage) +
      Number(customerCommissionPercentage);

    if (totalCommission > 100) {
      return res.status(400).json({
        message: "Total commission cannot exceed 100%",
      });
    }

    const updated = await CommissionSetting.findOneAndUpdate(
      {},
      {
        providerCommissionPercentage,
        customerCommissionPercentage,
        updatedBy: adminId,
        updatedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
      },
    );

    res.status(200).json({
      isSuccess: true,
      message: "Commission updated successfully",
      data: updated,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};
