// controllers/notificationController.js
const admin = require("../utils/firebase"); // ✅ use initialized admin

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
    title: "✨ New Service Created",
    body: `A ${service.title} service is near you (${distance.toFixed(
      1
    )} km away)!`,
  };
}

function buildUpdateMessage(service) {
  return {
    title: "🔔 Service Updated",
    body: `Good news! The details of "${service.title}"  have been updated in your area.`,
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
    body: `${viewer.name} just checked out your service "${service.title}"`,
  };
}
// Common notification handler for services
async function notifyUsersForService(service, scenarioType) {
  try {
    console.log(
      `🚀 Starting notification for service "${service.title}" [${scenarioType}]`
    );

    const users = await User.find({
      interests: { $in: service.tags },
      is_active: true,
    });

    console.log(`Found ${users.length} active users with matching interests`);

    let notifiedUsers = [];

    for (const user of users) {
      // ❌ Skip the service owner
      if (String(user._id) === String(service.owner)) {
        console.log(`🙈 Skipping owner ${user.name} for their own service`);
        continue;
      }

      if (!user.fcmToken?.length) {
        console.log(`⚠️ Skipping ${user.name} - no FCM token`);
        continue;
      }

      if (!user.lastLocation?.coords) {
        console.log(`⚠️ Skipping ${user.name} - no last location`);
        continue;
      }

      const dist = getDistanceFromLatLonInKm(
        service.location.coordinates[1],
        service.location.coordinates[0],
        user.lastLocation.coords.coordinates[1],
        user.lastLocation.coords.coordinates[0]
      );

      if (dist > 10) {
        console.log(
          `⏩ Skipping ${user.name} - distance ${dist.toFixed(2)}km > 10km`
        );
        continue;
      }

      const key = `${scenarioType}-${user._id}-${service._id}`;
      if (!global.notifiedMap) global.notifiedMap = {};
      if (global.notifiedMap[key]) {
        console.log(`⏱ Already notified ${user.name} recently, skipping`);
        continue;
      }

      // Build different messages and payload type
      let message, payloadType;
      if (scenarioType === "new") {
        message = buildNewServiceMessage(service, dist);
        payloadType = "NewService";
      } else if (scenarioType === "update") {
        message = buildUpdateMessage(service);
        payloadType = "UpdateService";
      } else {
        message = { title: "Notification", body: `${service.title}` };
        payloadType = "GenericService";
      }

      const payload = {
        tokens: user.fcmToken,
        notification: { title: message.title, body: message.body },
        data: {
          type: payloadType,
          pageType: "ServiceDetailsPage",
          serviceId: service._id.toString(),
          userId: user._id.toString(),
        },
      };

      try {
        const response = await admin.messaging().sendEachForMulticast(payload);
        response.responses.forEach((res, index) => {
          const token = payload.tokens[index];
          if (res.success) console.log(`✅ Sent to token: ${token}`);
          else
            console.log(
              `❌ Failed for token: ${token} - ${res.error?.message}`
            );
        });

        global.notifiedMap[key] = true;
        notifiedUsers.push(user.name);
      } catch (err) {
        console.error(
          `❌ Failed to send notification to ${user.name}:`,
          err.message
        );
      }
    }

    console.log(`🎯 Finished notification for service "${service.title}"`);
    console.log(`📣 Total users notified: ${notifiedUsers.length}`);
    if (notifiedUsers.length > 0)
      console.log(`Users notified: ${notifiedUsers.join(", ")}`);

    return notifiedUsers.length;
  } catch (err) {
    console.error(
      `❌ Notification error [${scenarioType}] for service "${service.title}":`,
      err.message
    );
    return 0;
  }
}

// New: Notify nearby users when a user updates interests
async function notifyNearbyUsersOnInterestUpdate(userId) {
  try {
    // ✅ Fetch updated user
    const user = await User.findById(userId);
    if (!user) return console.log("User not found");

    console.log(`🚀 Interest update notification start for ${user.name}`);
    console.log("Updated interests:", user.interests);

    // ✅ Find nearby active users with at least one matching interest
    const nearbyUsers = await User.find({
      _id: { $ne: user._id }, // exclude self
      is_active: true,
      interests: { $in: user.interests },
      lastLocation: { $exists: true },
    });

    let notifiedUsers = [];

    for (const nearUser of nearbyUsers) {
      // Skip if no token or no location
      if (!nearUser.fcmToken?.length || !nearUser.lastLocation?.coords) continue;

      // Remove any tokens that belong to the updating user
      const tokensToSend = nearUser.fcmToken.filter(
        (t) => !user.fcmToken?.includes(t)
      );
      if (!tokensToSend.length) continue; // skip if no valid token

      // Calculate distance
      const dist = getDistanceFromLatLonInKm(
        user.lastLocation.coords.coordinates[1],
        user.lastLocation.coords.coordinates[0],
        nearUser.lastLocation.coords.coordinates[1],
        nearUser.lastLocation.coords.coordinates[0]
      );
      if (dist > 10) continue; // skip far users

      // Find mutual interests
      const mutualInterests = nearUser.interests.filter((i) =>
        user.interests.includes(i)
      );
      if (!mutualInterests.length) continue;

      // Build notification
      const message = {
        title: "👋 Someone nearby updated their interests!",
        body: `${user.name} now shares your interest in ${mutualInterests.join(
          ", "
        )}. Tap to check out their profile!`,
        image: user.profile_image || "", // profile image included
      };

      const payload = {
        tokens: tokensToSend,
        notification: message,
        data: {
          type: "UserInterestUpdate",
          pageType: "UserProfilePage",
          viewerId: user._id.toString(),
          viewerName: user.name,
          viewerProfileImage: user.profile_image || "",
        },
      };

      // Send notification
      try {
        const response = await admin.messaging().sendEachForMulticast(payload);
        console.log(
          `📩 Sent to ${nearUser.name}: ${response.successCount} success, ${response.failureCount} failed`
        );
        notifiedUsers.push(nearUser.name);
      } catch (err) {
        console.error(`❌ Failed to notify ${nearUser.name}:`, err.message);
      }
    }

    console.log(`🎯 Done! Notified users: ${notifiedUsers.join(", ")}`);
    return notifiedUsers;
  } catch (err) {
    console.error("❌ Error in notifyNearbyUsersOnInterestUpdate:", err.message);
  }
}


const notifiedViewMap = {}; // cooldown memory

async function notifyOnServiceView(service, viewer) {
  try {
    const owner = service.owner;

    console.log("🧩 notifyOnServiceView() called with:");
    console.log("   → Owner ID:", owner?._id?.toString());
    console.log("   → Viewer ID:", viewer?._id?.toString());
    console.log("   → Service ID:", service?._id?.toString());

    // 🧠 Skip if viewer is the same as owner
    if (!owner || String(owner._id) === String(viewer._id)) {
      console.log(
        `🙈 Self-view detected for ${viewer?.name}, skipping notification`
      );
      return;
    }

    // 🚫 Skip if no FCM token
    if (
      !owner?.fcmToken ||
      !Array.isArray(owner.fcmToken) ||
      owner.fcmToken.length === 0
    ) {
      console.log(
        `⚠️ Owner ${owner.name} has no FCM token, skipping notification`
      );
      return;
    }

    // 🕒 60-minute cooldown key
    // const key = `${service._id}-${viewer._id}-${owner._id}`;
    // if (notifiedViewMap[key]) {
    //   console.log(`⏱ Already notified within the last 60 minutes, skipping`);
    //   return;
    // }

    // notifiedViewMap[key] = true;
    // setTimeout(() => delete notifiedViewMap[key], 1000 * 60 * 60); // 60 minutes = 1 hour

    console.log("✉️ Building FCM message payload...");

    const message = buildServiceViewMessage(viewer, service);
    const payload = {
      tokens: owner.fcmToken,
      notification: { title: message.title, body: message.body },
      data: {
        type: "ServiceView",
        pageType: "UserProfilePage",
        serviceId: service._id.toString(),
        viewerId: viewer._id.toString(),
        viewerName: viewer.name,
        viewerProfileImage: viewer.profile_image || "",
      },
    };

    console.log("📨 Payload prepared:", payload);

    const response = await admin.messaging().sendEachForMulticast(payload);

    console.log(
      `✅ Notified ${owner.name}: ${response.successCount} success, ${response.failureCount} failed`
    );

    response.responses.forEach((res, i) => {
      if (res.success) console.log(`✅ Sent to token: ${payload.tokens[i]}`);
      else
        console.log(
          `❌ Failed for token: ${payload.tokens[i]} - ${res.error?.message}`
        );
    });
  } catch (err) {
    console.error("❌ Service view notification error:", err.message);
  }
}

// -------------------------------
// getservicbyId
// -------------------------------

// exports.getservicbyId = async (req, res) => {
//   try {
//     const { serviceId, latitude, longitude, viewerId } = req.body;

//     console.log("🚀 getservicbyId called with", {
//       serviceId,
//       viewerId,
//       latitude,
//       longitude,
//     });

//     // Step 1: Check if viewerId exists
//     if (!viewerId) {
//       console.log("⚠️ viewerId missing in request body");
//     }

//     // Step 2: Validate serviceId
//     if (!serviceId) {
//       console.log("❌ Missing serviceId");
//       return res
//         .status(400)
//         .json({ isSuccess: false, message: "serviceId is required" });
//     }

//     if (!mongoose.Types.ObjectId.isValid(serviceId)) {
//       console.log("❌ Invalid serviceId format:", serviceId);
//       return res
//         .status(400)
//         .json({ isSuccess: false, message: "Invalid serviceId" });
//     }

//     // Step 3: Find service
//     console.log("🔍 Fetching service from DB...");
//     const service = await Service.findById(serviceId);
//     if (!service) {
//       console.log("❌ Service not found in DB");
//       return res
//         .status(404)
//         .json({ isSuccess: false, message: "Service not found" });
//     }

//     // Step 4: Populate relations
//     await service.populate(
//       "owner",
//       "name profile_image notifyOnProfileView fcmToken"
//     );
//     await service.populate("category", "name");

//     console.log(`✅ Service found: ${service.title}`);
//     console.log(
//       `📌 Owner: ${service.owner.name}, notifyOnProfileView: ${service.owner.notifyOnProfileView}`
//     );

//     // Step 5: Notify owner if viewerId is provided
//     if (viewerId) {
//       console.log(`👤 Trying to find viewer in DB: ${viewerId}`);
//       const viewer = await User.findById(viewerId).select("name profile_image");
//       if (viewer) {
//         console.log(
//           `🚀 Sending view notification to owner for viewer ${viewerId} (${viewer.name})`
//         );
//         notifyOnServiceView(service, viewer).catch((err) =>
//           console.error("Notification error:", err)
//         );
//       } else {
//         console.log(`⚠️ Viewer not found in DB for ID: ${viewerId}`);
//       }
//     } else {
//       console.log("🚫 Skipping notification — viewerId not provided");
//     }

//     // Step 6: Distance calculation
//     let distance_km = null;
//     if (latitude && longitude && service.location?.coordinates) {
//       const [lon, lat] = service.location.coordinates;
//       distance_km = getDistanceKm(latitude, longitude, lat, lon);
//       console.log(`📍 Calculated distance: ${distance_km.toFixed(2)} km`);
//     } else {
//       console.log("📍 Skipping distance calculation (lat/long missing)");
//     }

//     // Step 7: Reviews
//     console.log("📝 Fetching reviews...");
//     const reviews = await Review.find({ service: serviceId })
//       .populate("user", "name profile_image")
//       .sort({ created_at: -1 });

//     let avgRating = 0;
//     if (reviews.length > 0) {
//       const total = reviews.reduce((sum, r) => sum + r.rating, 0);
//       avgRating = Number((total / reviews.length).toFixed(1));
//     }
//     console.log(
//       `⭐ Reviews fetched: ${reviews.length}, averageRating: ${avgRating}`
//     );

//     // Step 8: Final response
//     return res.json({
//       isSuccess: true,
//       message: "Service found successfully",
//       data: {
//         service,
//         reviews,
//         totalReviews: reviews.length,
//         averageRating: avgRating,
//         distance_km,
//       },
//     });
//   } catch (err) {
//     console.error("💥 getservicbyId error:", err);
//     return res.status(500).json({
//       isSuccess: false,
//       message: "Server error",
//       error: err.message,
//     });
//   }
// };

// Exports
exports.notifyOnNewService = (service) => notifyUsersForService(service, "new");
exports.notifyOnUpdate = (service) => notifyUsersForService(service, "update");
exports.notifyOnUserInterestUpdate = notifyNearbyUsersOnInterestUpdate;
exports.notifyOnServiceView = notifyOnServiceView;
//notificaton addd
