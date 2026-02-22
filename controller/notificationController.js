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
// 🔔 Admin approved delete - Customer
function buildServiceDeletedByAdminForCustomer(service) {
  return {
    title: "❌ Service Cancelled",
    body: `The service "${service.title}" has been cancelled by admin.`,
  };
}
// 🔔 Admin promoted service - Provider
function buildServicePromotedMessage(service) {
  return {
    title: "🚀 Service Promoted!",
    body: `Your service "${service.title}" has been promoted by admin for 30 days.`,
  };
}
// 🔔 Admin approved delete - Provider
function buildServiceDeleteApprovedForProvider(service) {
  return {
    title: "✅ Delete Request Approved",
    body: `Your request to delete "${service.title}" was approved by admin.`,
  };
}

// Notification message templates
function buildNewServiceMessage(service, distance) {
  return {
    title: "✨ New Service Created",
    body: `A ${service.title} service is near you (${distance.toFixed(
      1,
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
      ", ",
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
      `🚀 Starting notification for service "${service.title}" [${scenarioType}]`,
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
        user.lastLocation.coords.coordinates[0],
      );

      if (dist > 10) {
        console.log(
          `⏩ Skipping ${user.name} - distance ${dist.toFixed(2)}km > 10km`,
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
              `❌ Failed for token: ${token} - ${res.error?.message}`,
            );
        });

        global.notifiedMap[key] = true;
        notifiedUsers.push(user.name);
      } catch (err) {
        console.error(
          `❌ Failed to send notification to ${user.name}:`,
          err.message,
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
      err.message,
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
      if (!nearUser.fcmToken?.length || !nearUser.lastLocation?.coords)
        continue;

      // Remove any tokens that belong to the updating user
      const tokensToSend = nearUser.fcmToken.filter(
        (t) => !user.fcmToken?.includes(t),
      );
      if (!tokensToSend.length) continue; // skip if no valid token

      // Calculate distance
      const dist = getDistanceFromLatLonInKm(
        user.lastLocation.coords.coordinates[1],
        user.lastLocation.coords.coordinates[0],
        nearUser.lastLocation.coords.coordinates[1],
        nearUser.lastLocation.coords.coordinates[0],
      );
      if (dist > 10) continue; // skip far users

      // Find mutual interests
      const mutualInterests = nearUser.interests.filter((i) =>
        user.interests.includes(i),
      );
      if (!mutualInterests.length) continue;

      // Build notification
      const message = {
        title: "👋 Someone nearby updated their interests!",
        body: `${user.name} now shares your interest in ${mutualInterests.join(
          ", ",
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
          `📩 Sent to ${nearUser.name}: ${response.successCount} success, ${response.failureCount} failed`,
        );
        notifiedUsers.push(nearUser.name);
      } catch (err) {
        console.error(`❌ Failed to notify ${nearUser.name}:`, err.message);
      }
    }

    console.log(`🎯 Done! Notified users: ${notifiedUsers.join(", ")}`);
    return notifiedUsers;
  } catch (err) {
    console.error(
      "❌ Error in notifyNearbyUsersOnInterestUpdate:",
      err.message,
    );
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
        `🙈 Self-view detected for ${viewer?.name}, skipping notification`,
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
        `⚠️ Owner ${owner.name} has no FCM token, skipping notification`,
      );
      return;
    }

    //  🕒 60-minute cooldown key
    const key = `${service._id}-${viewer._id}-${owner._id}`;
    if (notifiedViewMap[key]) {
      console.log(`⏱ Already notified within the last 60 minutes, skipping`);
      return;
    }

    notifiedViewMap[key] = true;
    setTimeout(() => delete notifiedViewMap[key], 1000 * 60 * 60); // 60 minutes = 1 hour

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
      `✅ Notified ${owner.name}: ${response.successCount} success, ${response.failureCount} failed`,
    );

    response.responses.forEach((res, i) => {
      if (res.success) console.log(`✅ Sent to token: ${payload.tokens[i]}`);
      else
        console.log(
          `❌ Failed for token: ${payload.tokens[i]} - ${res.error?.message}`,
        );
    });
  } catch (err) {
    console.error("❌ Service view notification error:", err.message);
  }
}
async function sendBookingNotification(customer, provider, service, booking) {
  console.log("🔔 sendBookingNotification CALLED");

  try {
    console.log("Customer Tokens →", customer.fcmToken);
    console.log("Provider Tokens →", provider.fcmToken);

    // 🎉 Message for Customer
    if (customer.fcmToken?.length > 0) {
      console.log("📤 Sending Customer Notification…");

      await admin.messaging().sendEachForMulticast({
        tokens: customer.fcmToken,
        notification: {
          title: "🎉 Service Booked Successfully!",
          body: `You booked "${service.title}" with ${provider.name}. Amount: ₹${booking.amount}`,
        },
        data: {
          type: "booking_success",
          userType: "customer",
          bookingId: booking._id.toString(),
        },
      });

      console.log("✅ Customer Notification Sent");
    } else {
      console.log("⚠️ Customer has NO FCM TOKENS");
    }

    // 🛎 Message for Provider
    if (provider.fcmToken?.length > 0) {
      console.log("📤 Sending Provider Notification…");

      await admin.messaging().sendEachForMulticast({
        tokens: provider.fcmToken,
        notification: {
          title: "🛎 New Booking Received!",
          body: `${customer.name} booked "${service.title}". Amount: ₹${booking.amount}`,
        },
        data: {
          type: "booking_received",
          userType: "provider",
          bookingId: booking._id.toString(),
        },
      });

      console.log("✅ Provider Notification Sent");
    } else {
      console.log("⚠️ Provider has NO FCM TOKENS");
    }

    console.log("🔔 All Notifications Sent");
  } catch (err) {
    console.error("❌ Notification error:", err);
  }
}

async function sendServiceStartedNotification(
  customer,
  provider,
  service,
  booking,
) {
  try {
    if (!customer.fcmToken?.length) {
      console.log("❌ Customer has no FCM token");
      return;
    }

    console.log("📨 Sending service started notification to customer...");

    await admin.messaging().sendEachForMulticast({
      tokens: customer.fcmToken,
      notification: {
        title: "🚀 Service Started",
        body: `${provider.name} has started your service "${service.title}".`,
      },
      data: {
        type: "service_started",
        userType: "customer",
        bookingId: booking._id.toString(),
      },
    });

    console.log("✅ Customer notified: service started");
  } catch (err) {
    console.error(
      "❌ Error sending service-started notification:",
      err.message,
    );
  }
}
async function sendServiceCompletedNotification(
  customer,
  provider,
  service,
  booking,
) {
  console.log("🔔 sendServiceCompletedNotification CALLED");

  try {
    console.log("Customer Tokens →", customer.fcmToken);
    console.log("Provider Tokens →", provider.fcmToken);

    // 🎉 Notify Customer
    if (customer.fcmToken?.length > 0) {
      console.log("📤 Sending Customer Notification…");

      await admin.messaging().sendEachForMulticast({
        tokens: customer.fcmToken,
        notification: {
          title: "✅ Service Completed",
          body: `${provider.name} has completed your service "${service.title}".`,
        },
        data: {
          type: "service_completed",
          userType: "customer",
          bookingId: booking._id.toString(),
        },
      });

      console.log("✅ Customer Notification Sent");
    } else {
      console.log("⚠️ Customer has NO FCM TOKENS");
    }

    // 🛎 Notify Provider
    if (provider.fcmToken?.length > 0) {
      console.log("📤 Sending Provider Notification…");

      await admin.messaging().sendEachForMulticast({
        tokens: provider.fcmToken,
        notification: {
          title: "🛎 Service Completed",
          body: `You completed "${service.title}" for ${customer.name}.`,
        },
        data: {
          type: "service_completed",
          userType: "provider",
          bookingId: booking._id.toString(),
        },
      });

      console.log("✅ Provider Notification Sent");
    } else {
      console.log("⚠️ Provider has NO FCM TOKENS");
    }

    console.log("🎉 All Service Completed Notifications Sent");
  } catch (err) {
    console.error("❌ Notification error:", err.message);
  }
}
async function sendServiceCancelledNotification(
  customer,
  provider,
  service,
  booking,
  reason = "",
) {
  console.log("🔔 [NOTIFICATION] Function Called");

  try {
    console.log("🔔 Customer Tokens:", customer.fcmToken);
    console.log("🔔 Provider Tokens:", provider.fcmToken);

    // CUSTOMER NOTIFICATION
    if (customer.fcmToken?.length > 0) {
      console.log("📤 Sending Customer Cancel Notification…");

      await admin.messaging().sendEachForMulticast({
        tokens: customer.fcmToken,
        notification: {
          title: "❌ Service Cancelled",
          body: `Your service "${service.title}" has been cancelled.`,
        },
        data: {
          type: "service_cancelled",
          userType: "customer",
          bookingId: booking._id.toString(),
          reason: reason || "",
        },
      });

      console.log("✅ Customer Cancel Notification Sent");
    } else {
      console.log("⚠️ Customer has NO FCM Tokens");
    }

    // PROVIDER NOTIFICATION
    if (provider.fcmToken?.length > 0) {
      console.log("📤 Sending Provider Cancel Notification…");

      await admin.messaging().sendEachForMulticast({
        tokens: provider.fcmToken,
        notification: {
          title: "❌ Service Cancelled",
          body: `The service "${service.title}" was cancelled by ${customer.name}.`,
        },
        data: {
          type: "service_cancelled",
          userType: "provider",
          bookingId: booking._id.toString(),
          reason: reason || "",
        },
      });

      console.log("✅ Provider Cancel Notification Sent");
    } else {
      console.log("⚠️ Provider has NO FCM Tokens");
    }

    console.log("🎉 All Cancellation Notifications Sent");
  } catch (err) {
    console.error("❌ Cancel Notification Error:", err.message);
  }
}

async function notifyOnServiceDeleteApproved(service, bookings) {
  console.log("🔔 ===============================");
  console.log("🔔 notifyOnServiceDeleteApproved CALLED");
  console.log("🆔 Service ID:", service?._id?.toString());
  console.log("📛 Service Title:", service?.title);

  try {
    // =========================
    // 1️⃣ NOTIFY CUSTOMERS
    // =========================
    console.log("👥 Starting CUSTOMER notifications...");

    for (const booking of bookings) {
      const customer = booking.customer;

      if (!customer) {
        console.log("⚠️ Booking without customer, skipping");
        continue;
      }

      console.log(
        `👤 Customer Found → Name: ${customer.name}, Email: ${customer.email}`,
      );

      if (!customer.fcmToken || !customer.fcmToken.length) {
        console.log(`⚠️ Customer ${customer.name} has NO FCM tokens, skipping`);
        continue;
      }

      console.log(
        `📲 Customer FCM Tokens (${customer.fcmToken.length}):`,
        customer.fcmToken,
      );

      const message = buildServiceDeletedByAdminForCustomer(service);

      console.log(`📨 Sending notification to CUSTOMER: ${customer.name}`);

      const response = await admin.messaging().sendEachForMulticast({
        tokens: customer.fcmToken,
        notification: message,
        data: {
          type: "service_deleted_by_admin",
          userType: "customer",
          serviceId: service._id.toString(),
          bookingId: booking._id.toString(),
        },
      });

      console.log(
        `📬 Customer ${customer.name} → Success: ${response.successCount}, Failed: ${response.failureCount}`,
      );

      response.responses.forEach((res, index) => {
        const token = customer.fcmToken[index];
        if (res.success) {
          console.log(`✅ Sent to customer token: ${token}`);
        } else {
          console.log(
            `❌ Failed customer token: ${token} - ${res.error?.message}`,
          );
        }
      });
    }

    // =========================
    // 2️⃣ NOTIFY PROVIDER
    // =========================
    console.log("🧑‍🔧 Starting PROVIDER notification...");

    const provider = service.owner;

    if (!provider) {
      console.log("❌ No provider found on service");
    } else {
      console.log(
        `👤 Provider Found → Name: ${provider.name}, Email: ${provider.email}`,
      );

      if (!provider.fcmToken || !provider.fcmToken.length) {
        console.log(`⚠️ Provider ${provider.name} has NO FCM tokens, skipping`);
      } else {
        console.log(
          `📲 Provider FCM Tokens (${provider.fcmToken.length}):`,
          provider.fcmToken,
        );

        const message = buildServiceDeleteApprovedForProvider(service);

        console.log(`📨 Sending notification to PROVIDER: ${provider.name}`);

        const response = await admin.messaging().sendEachForMulticast({
          tokens: provider.fcmToken,
          notification: message,
          data: {
            type: "service_delete_approved",
            userType: "provider",
            serviceId: service._id.toString(),
          },
        });

        console.log(
          `📬 Provider ${provider.name} → Success: ${response.successCount}, Failed: ${response.failureCount}`,
        );

        response.responses.forEach((res, index) => {
          const token = provider.fcmToken[index];
          if (res.success) {
            console.log(`✅ Sent to provider token: ${token}`);
          } else {
            console.log(
              `❌ Failed provider token: ${token} - ${res.error?.message}`,
            );
          }
        });
      }
    }

    console.log("🎉 All delete-approval notifications COMPLETED");
    console.log("🔔 ===============================");
  } catch (err) {
    console.error("❌ Error in notifyOnServiceDeleteApproved:", err.message);
  }
}

async function sendServiceForceDeletedNotification({
  provider,
  customers = [],
  service,
}) {
  console.log("🔔 sendServiceForceDeletedNotification CALLED");

  try {
    // ===============================
    // 🔴 PROVIDER NOTIFICATION
    // ===============================
    const providerTokens = Array.isArray(provider?.fcmToken)
      ? provider.fcmToken
      : provider?.fcmToken
        ? [provider.fcmToken]
        : [];

    if (providerTokens.length > 0) {
      try {
        await admin.messaging().sendEachForMulticast({
          tokens: providerTokens,
          notification: {
            title: "⚠️ Service Removed by Admin",
            body: `Your service "${service.title}" has been removed following an administrative review.`,
          },
          data: {
            type: "service_force_deleted",
            userType: "provider",
            serviceId: service._id.toString(),
          },
        });

        console.log("📬 Provider notification sent");
      } catch (err) {
        console.error("❌ Provider notification failed:", err.message);
      }
    } else {
      console.log("⚠️ Provider has no FCM token");
    }

    // ===============================
    // 🟢 CUSTOMER NOTIFICATIONS (ONLY IF BOOKED)
    // ===============================
    if (Array.isArray(customers) && customers.length > 0) {
      console.log(
        `📨 Sending notifications to ${customers.length} customer(s)...`,
      );

      for (const customer of customers) {
        const customerTokens = Array.isArray(customer?.fcmToken)
          ? customer.fcmToken
          : customer?.fcmToken
            ? [customer.fcmToken]
            : [];

        if (!customerTokens.length) {
          console.log(`⚠️ Customer ${customer._id} has no FCM token, skipped`);
          continue;
        }

        try {
          await admin.messaging().sendEachForMulticast({
            tokens: customerTokens,
            notification: {
              title: "❌ Service Cancelled",
              body: `The service "${service.title}" you booked has been cancelled by admin. Refund (if any) will be processed shortly.`,
            },
            data: {
              type: "service_force_deleted",
              userType: "customer",
              serviceId: service._id.toString(),
            },
          });

          console.log(`📬 Customer notification sent → ${customer._id}`);
        } catch (err) {
          console.error(
            `❌ Customer notification failed (${customer._id}):`,
            err.message,
          );
        }
      }
    } else {
      console.log("ℹ️ No booked customers → customer notifications skipped");
    }
  } catch (err) {
    console.error("❌ Force delete notification block failed:", err.message);
  }
}
async function notifyOnServicePromoted(service) {
  try {
    console.log("🔔 notifyOnServicePromoted CALLED");

    const provider = service.owner;

    if (!provider) {
      console.log("❌ No provider found for service");
      return;
    }

    // populate safety
    if (!provider.fcmToken || !provider.fcmToken.length) {
      console.log(`⚠️ Provider ${provider.name} has NO FCM tokens, skipping`);
      return;
    }

    const message = buildServicePromotedMessage(service);

    const payload = {
      tokens: provider.fcmToken,
      notification: message,
      data: {
        type: "service_promoted",
        pageType: "ProviderServicePage",
        serviceId: service._id.toString(),
      },
    };

    console.log(
      "📨 Sending promotion notification to provider:",
      provider.name,
    );

    const response = await admin.messaging().sendEachForMulticast(payload);

    console.log(
      `✅ Promotion notification sent → Success: ${response.successCount}, Failed: ${response.failureCount}`,
    );
  } catch (err) {
    console.error("❌ Error in notifyOnServicePromoted:", err.message);
  }
}
// Exports
exports.notifyOnNewService = (service) => notifyUsersForService(service, "new");
exports.notifyOnUpdate = (service) => notifyUsersForService(service, "update");
exports.notifyOnUserInterestUpdate = notifyNearbyUsersOnInterestUpdate;
exports.notifyOnServiceView = notifyOnServiceView;
module.exports.sendBookingNotification = sendBookingNotification;
module.exports.sendServiceStartedNotification = sendServiceStartedNotification;
module.exports.sendServiceCompletedNotification =
  sendServiceCompletedNotification;
module.exports.sendServiceCancelledNotification =
  sendServiceCancelledNotification;
module.exports.notifyOnServiceDeleteApproved = notifyOnServiceDeleteApproved;
module.exports.sendServiceForceDeletedNotification =
  sendServiceForceDeletedNotification;
module.exports.notifyOnServicePromoted = notifyOnServicePromoted;
//notificaton addd
