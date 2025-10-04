// controllers/notificationController.js
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

function buildUpdateMessage(service) {
  return {
    title: `🔔 Service Updated: ${service.title}`,
    body: `"${service.title}" details have been updated near you!`,
  };
}

// New: User interest update notification
function buildUserInterestUpdateMessage(user, mutualInterests) {
  return {
    title: `👋 Nearby user updated interests!`,
    body: `${user.name} now likes ${mutualInterests.join(
      ", "
    )}. Tap to view their profile.`,
  };
}
function buildServiceViewMessage(viewer, service) {
  return {
    title: `👀 ${viewer.name} viewed your service!`,
    body: `${viewer.name} checked out "${service.title}"`,
  };
}
// Common notification handler for services
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
      if (scenarioType === "new") {
        message = buildNewServiceMessage(service, dist);
      } else {
        message = buildUpdateMessage(service);
      }

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

// New: Notify nearby users when a user updates interests
async function notifyNearbyUsersOnInterestUpdate(user) {
  try {
    const users = await User.find({
      _id: { $ne: user._id }, // exclude self
      interests: { $in: user.interests },
      is_active: true,
      lastLocation: { $exists: true },
    });

    for (const nearbyUser of users) {
      const dist = getDistanceFromLatLonInKm(
        user.lastLocation.coords.coordinates[1],
        user.lastLocation.coords.coordinates[0],
        nearbyUser.lastLocation.coords.coordinates[1],
        nearbyUser.lastLocation.coords.coordinates[0]
      );

      if (dist > 10) continue; // only within 10km

      const mutualInterests = nearbyUser.interests.filter((i) =>
        user.interests.includes(i)
      );
      if (!mutualInterests.length) continue;

      const key = `interest-${nearbyUser._id}-${user._id}`;
      if (notifiedMap[key]) continue;

      const message = buildUserInterestUpdateMessage(user, mutualInterests);

      const payload = {
        tokens: [nearbyUser.fcmToken],
        notification: { title: message.title, body: message.body },
        data: {
          type: "UserInterestUpdate",
          pageType: "UserDetailPage",
          userId: user._id.toString(), // the user who updated interests
        },
      };

      await admin.messaging().sendMulticast(payload);
      notifiedMap[key] = true;

      console.log(
        `✅ Notified ${nearbyUser.name} about interest update of ${user.name}`
      );
    }
  } catch (err) {
    console.error("❌ Interest update notification error:", err.message);
  }
}
const notifiedViewMap = {}; // separate map for views to rate-limit
async function notifyOnServiceView(serviceId, viewerId) {
  try {
    const service = await Service.findById(serviceId).populate("owner");
    if (!service || !service.owner) return;

    const owner = service.owner;

    if (!owner.notifyOnProfileView) return; // owner toggle

    const viewer = await User.findById(viewerId);
    if (!viewer) return;

    const key = `${serviceId}-${viewerId}-${owner._id}`;
    if (notifiedViewMap[key]) return;
    notifiedViewMap[key] = true;
    setTimeout(() => delete notifiedViewMap[key], 1000 * 60 * 5); // 5 min cooldown

    if (!owner.fcmToken) return;

    const message = buildServiceViewMessage(viewer, service);

    const payload = {
      tokens: [owner.fcmToken],
      notification: { title: message.title, body: message.body },
      data: {
        type: "ServiceView",
        pageType: "UserProfilePage",
        serviceId: service._id.toString(),
        viewerId: viewer._id.toString(),
      },
    };

    await admin.messaging().sendMulticast(payload);
    console.log(`✅ Notified ${owner.name} that ${viewer.name} viewed "${service.title}"`);
  } catch (err) {
    console.error("❌ Service view notification error:", err.message);
  }
}

// Exports
exports.notifyOnNewService = (service) =>
  notifyUsersForService(service, "new");
exports.notifyOnUpdate = (service) => notifyUsersForService(service, "update");
exports.notifyOnUserInterestUpdate = notifyNearbyUsersOnInterestUpdate;
exports.notifyOnServiceView = notifyOnServiceView;