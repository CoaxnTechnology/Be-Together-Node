const CommissionSetting = require("../model/CommissionSetting");

exports.getCommission = async (req, res) => {
  try {
    const setting = await CommissionSetting.findOne();
    res.status(200).json({ percentage: setting?.percentage || 20 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateCommission = async (req, res) => {
  try {
    const { percentage, adminId } = req.body;
    if (percentage < 0 || percentage > 100)
      return res.status(400).json({ message: "Invalid commission value" });

    const updated = await CommissionSetting.findOneAndUpdate(
      {},
      { percentage, updatedBy: adminId, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.status(200).json({
      isSuccess: true,
      message: `Commission updated to ${percentage}%`,
      data: updated,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
