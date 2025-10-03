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
const admin = require("firebase-admin");
const User = require("../model/User");
const Service = require("../model/Service");
const Category = require("../model/Category");

const notifiedMap = {}; // To avoid duplicate notifications

// Helper: distance calculation
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Notification message templates
function buildNewServiceMessage(service, distance) {
  return {
    title: `✨ New Service: ${service.title}`,
    body: `A ${service.category} service is near you (${distance.toFixed(
      1
    )} km away)!`,
  };
}

function buildAvailabilityUpdateMessage(service) {
  return {
    title: `⚡ Service Update: ${service.title}`,
    body: `"${service.title}" is now available near you!`,
  };
}

function buildLocationUpdateMessage(service, distance) {
  return {
    title: `📍 Location Update: ${service.title}`,
    body: `"${service.title}" moved closer (${distance.toFixed(1)} km away)!`,
  };
}

function buildGeneralUpdateMessage(service) {
  return {
    title: `🔔 Service Updated: ${service.title}`,
    body: `"${service.title}" details have been updated near you!`,
  };
}

// Common notification handler
async function notifyUsersForService(service, scenarioType) {
  try {
    const users = await User.find({
      interests: { $in: service.tags },
      is_active: true,
    });

    for (const user of users) {
      if (!user.fcmToken || !user.lastLocation) continue;

      const dist = getDistanceFromLatLonInKm(
        service.latitude,
        service.longitude,
        user.lastLocation.coords.coordinates[1],
        user.lastLocation.coords.coordinates[0]
      );

      if (dist > 10) continue;

      const key = `${scenarioType}-${user._id}-${service._id}`;
      if (notifiedMap[key]) continue;

      let message;
      if (scenarioType === "new")
        message = buildNewServiceMessage(service, dist);
      else if (scenarioType === "availability")
        message = buildAvailabilityUpdateMessage(service);
      else if (scenarioType === "location")
        message = buildLocationUpdateMessage(service, dist);
      else if (scenarioType === "update")
        message = buildGeneralUpdateMessage(service);
      else message = buildNewServiceMessage(service, dist);

      const payload = {
        tokens: [user.fcmToken],
        notification: { title: message.title, body: message.body },
        data: {
          type: "Notify",
          pageType: "ServiceDetailsPage",
          serviceId: service._id.toString(),
          userId: user._id.toString(),
        },
      };

      await admin.messaging().sendMulticast(payload);
      notifiedMap[key] = true;
      console.log(
        `✅ Notified ${user.name} for ${scenarioType} of "${service.title}"`
      );
    }
  } catch (err) {
    console.error(`❌ Notification error [${scenarioType}]:`, err.message);
  }
}

// Notification wrappers
exports.notifyOnNewService = (service) => notifyUsersForService(service, "new");
exports.notifyOnAvailabilityUpdate = (service) =>
  notifyUsersForService(service, "availability");
exports.notifyOnLocationUpdate = (service) =>
  notifyUsersForService(service, "location");
exports.notifyOnFieldUpdate = (service) =>
  notifyUsersForService(service, "update");
