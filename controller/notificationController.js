// controllers/notificationController.js
const admin = require("../utils/firebase"); // your firebase.js

exports.sendTestNotification = async (req, res) => {
  try {
    const { tokens, notification, data } = req.body;

    if (!tokens || !Array.isArray(tokens) || !tokens.length) {
      return res.status(400).json({
        isSuccess: false,
        message: "Tokens array is required",
      });
    }

    // Send notifications in parallel
    const responses = await Promise.all(
      tokens.map((token) =>
        admin.messaging().send({
          token,
          notification: notification || { title: "Test", body: "Hello!" },
          data: data || {},
        })
      )
    );

    return res.json({
      isSuccess: true,
      message: "Notifications sent successfully",
      data: responses,
    });
  } catch (err) {
    console.error("sendNotification error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Failed to send notifications",
      error: err.message,
    });
  }
};
