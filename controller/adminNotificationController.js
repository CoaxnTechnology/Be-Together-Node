const AdminNotification = require("../model/AdminNotification");

// Sidebar badge — unread counts split by severity so the frontend can decide
// how loud to be (toast vs. plain number).
exports.getSummary = async (req, res) => {
  try {
    const [urgent, standard] = await Promise.all([
      AdminNotification.countDocuments({ isRead: false, severity: "urgent" }),
      AdminNotification.countDocuments({ isRead: false, severity: "standard" }),
    ]);
    res.json({
      isSuccess: true,
      data: { urgent, standard, total: urgent + standard },
    });
  } catch (err) {
    console.error("getSummary error:", err);
    res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

exports.listNotifications = async (req, res) => {
  try {
    const notifications = await AdminNotification.find()
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ isSuccess: true, data: notifications });
  } catch (err) {
    console.error("listNotifications error:", err);
    res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};

exports.markRead = async (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      await AdminNotification.updateOne({ _id: id }, { isRead: true });
    } else {
      await AdminNotification.updateMany({ isRead: false }, { isRead: true });
    }
    res.json({ isSuccess: true, message: "Marked as read" });
  } catch (err) {
    console.error("markRead error:", err);
    res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
