const CancellationSetting = require("../model/CancellationSetting");

exports.updateCancellationSetting = async (req, res) => {
  try {
    const { enabled, percentage } = req.body; // enabled: true/false

    const updated = await CancellationSetting.findOneAndUpdate(
      {},
      {
        enabled: enabled,
        percentage: enabled ? percentage : 0,
        updatedAt: new Date(),
      },
      { new: true, upsert: true }
    );

    return res.json({
      success: true,
      message: "Cancellation setting updated ✅",
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
exports.getCancellationSetting = async (req, res) => {
  try {
    const setting = await CancellationSetting.findOne();
    return res.json(setting || {}); // return empty object if not exist
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};