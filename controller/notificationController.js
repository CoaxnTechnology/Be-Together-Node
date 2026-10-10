// controllers/notificationController.js
const admin = require("../utils/firebase"); // ✅ use initialized admin

const User = require("../model/User");
const Service = require("../model/Service");
const Category = require("../model/Category");
const { formatDateTime } = require("../utils/dateTimeFormat");
const BASE_URL = process.env.BASE_URL;
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

  // ⭐ Different wording for a Service-Request-sourced booking (Category A
  // "Book Now" / Category B accepted Offer) vs a plain Service booking —
  // `booking.serviceRequest` is set only for the former, whether populated
  // or still a raw ObjectId, so a simple truthy check is enough here.
  const isRequestBooking = Boolean(booking.serviceRequest);
  const customerTitle = isRequestBooking
    ? "🎉 Your Request Has Been Booked!"
    : "🎉 Service Booked Successfully!";
  const customerBody = isRequestBooking
    ? `Your request "${service.title}" has been booked with ${provider.name}. Amount: ₹${booking.amount}`
    : `You booked "${service.title}" with ${provider.name}. Amount: ₹${booking.amount}`;
  const providerTitle = isRequestBooking
    ? "🛎 You've Been Booked for a Request!"
    : "🛎 New Booking Received!";
  const providerBody = isRequestBooking
    ? `${customer.name} booked you for their request "${service.title}". Amount: ₹${booking.amount}`
    : `${customer.name} booked "${service.title}". Amount: ₹${booking.amount}`;

  try {
    console.log("Customer Tokens →", customer.fcmToken);
    console.log("Provider Tokens →", provider.fcmToken);

    // 🎉 Message for Customer
    if (customer.fcmToken?.length > 0) {
      console.log("📤 Sending Customer Notification…");

      await admin.messaging().sendEachForMulticast({
        tokens: customer.fcmToken,
        notification: {
          title: customerTitle,
          body: customerBody,
        },
        data: {
          type: isRequestBooking ? "request_booking_success" : "booking_success",
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
          title: providerTitle,
          body: providerBody,
        },
        data: {
          type: isRequestBooking ? "request_booking_received" : "booking_received",
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
async function sendAmbassadorApprovedNotification(user) {
  try {
    if (!user.fcmToken?.length) {
      console.log("⚠️ User has no FCM token");
      return;
    }

    await admin.messaging().sendEachForMulticast({
      tokens: user.fcmToken,
      notification: {
        title: "🎉 Ambassador Approved",
        body: "Congratulations! You have been approved as an Ambassador.",
      },
      data: {
        type: "ambassador_approved",
        isAmbassador: "true",
        ambassadorStatus: "approved",
        userId: user._id.toString(),
      },
    });

    console.log("✅ Ambassador approval notification sent");
  } catch (err) {
    console.error("❌ Ambassador notification error:", err.message);
  }
}
async function sendAmbassadorRemovedNotification(user) {
  try {
    if (!user?.fcmToken?.length) {
      console.log("⚠️ User has no FCM tokens");
      return;
    }

    await admin.messaging().sendEachForMulticast({
      tokens: user.fcmToken,
      notification: {
        title: "⚠️ Ambassador Access Removed",
        body: "Your Ambassador access has been removed by admin.",
      },
      data: {
        type: "ambassador_removed",
        isAmbassador: "false",
        ambassadorStatus: "disabled",
        userId: user._id.toString(),
      },
    });

    console.log(`✅ Ambassador removal notification sent to ${user.name}`);
  } catch (err) {
    console.error("❌ sendAmbassadorRemovedNotification:", err.message);
  }
}
async function sendAmbassadorRejectedNotification(user, reason) {
  try {
    if (!user?.fcmToken?.length) {
      console.log("⚠️ User has no FCM tokens");
      return;
    }

    await admin.messaging().sendEachForMulticast({
      tokens: user.fcmToken,

      notification: {
        title: "❌ Ambassador Application Rejected",
        body:
          reason || "Your ambassador application has been rejected by admin.",
      },

      data: {
        type: "ambassador_rejected",
        ambassadorStatus: "rejected",
        userId: user._id.toString(),
        rejectionReason:
          reason || "Your ambassador application has been rejected.",
      },
    });

    console.log(`✅ Ambassador rejection notification sent to ${user.name}`);
  } catch (err) {
    console.error("❌ sendAmbassadorRejectedNotification:", err.message);
  }
}
async function sendExclusiveAmbassadorInvitationNotification(
  invitedUser,
  ambassador,
) {
  try {
    console.log("[sendExclusiveAmbassadorInvitationNotification] Starting", {
      invitedUserId: invitedUser?._id?.toString(),
      invitedUserName: invitedUser?.name,
      ambassadorId: ambassador?._id?.toString(),
      ambassadorName: ambassador?.name,
      fcmTokens: invitedUser?.fcmToken || [],
    });

    if (!invitedUser?.fcmToken?.length) {
      console.log("⚠️ Invited user has no FCM tokens");
      return;
    }

    const payload = {
      tokens: invitedUser.fcmToken,
      notification: {
        title: "🎉 Ambassador Invitation",
        body: `${ambassador.name} has invited you to become a BeTogether Ambassador. Review and accept the Ambassador Agreement to continue.`,
      },
      data: {
        type: "exclusive_ambassador_invitation",
        pageType: "WebView",
        agreementUrl: `${process.env.BASE_URL}/api/ambassador-terms`,
        ambassadorId: ambassador._id.toString(),
        ambassadorName: ambassador.name,
        userId: invitedUser._id.toString(),
      },
    };

    console.log(
      "[sendExclusiveAmbassadorInvitationNotification] Sending payload",
      payload,
    );

    const response = await admin.messaging().sendEachForMulticast(payload);

    console.log("[sendExclusiveAmbassadorInvitationNotification] Result", {
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
    });

    console.log(
      `✅ Exclusive Ambassador invitation notification sent to ${invitedUser.name}`,
    );
  } catch (err) {
    console.error(
      "❌ sendExclusiveAmbassadorInvitationNotification:",
      err.message,
    );
  }
}
// Daily push while an Ambassador invitation is unanswered — same payload as
// the original invitation so tapping it opens the Agreement again.
async function sendAmbassadorInvitationReminderNotification(invitedUser, expiresAt, daysLeft) {
  const date = new Date(expiresAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });
  const when =
    daysLeft <= 1 ? "It expires tomorrow" : `It expires in ${daysLeft} days (${date})`;
  await sendUserNotification(
    invitedUser,
    daysLeft <= 1
      ? "⏳ Last day for your Ambassador invitation"
      : "⏳ Your Ambassador invitation is waiting",
    `You haven't answered your BeTogether Ambassador invitation yet. ${when} — review and accept the Agreement to become an Ambassador.`,
    {
      type: "exclusive_ambassador_invitation",
      pageType: "WebView",
      agreementUrl: `${process.env.BASE_URL}/api/ambassador-terms`,
      userId: invitedUser._id,
      reminder: "true",
    },
  );
}

// Tells the exclusive ambassador who sent it that their invitation lapsed.
async function notifyAmbassadorInvitationExpired(inviter, invitedUser) {
  await sendUserNotification(
    inviter,
    "Ambassador invitation expired",
    `${invitedUser?.name || "The user"} didn't accept your Ambassador invitation within 7 days. You can send a new one.`,
    {
      type: "ambassador_invitation_expired",
      invitedUserId: invitedUser?._id || "",
    },
  );
}

async function sendAmbassadorInvitationNotification(invitedUser) {
  try {
    console.log("[sendAmbassadorInvitationNotification] Starting", {
      invitedUserId: invitedUser?._id?.toString(),
      invitedUserName: invitedUser?.name,
      fcmTokens: invitedUser?.fcmToken || [],
    });

    if (!invitedUser?.fcmToken?.length) {
      console.log("⚠️ Invited user has no FCM tokens");
      return;
    }

    const agreementUrl = `${process.env.BASE_URL}/api/ambassador-terms`;

    const payload = {
      tokens: invitedUser.fcmToken,

      notification: {
        title: "🎉 Ambassador Invitation",
        body: "BeTogether has invited you to become a BeTogether Ambassador. Please review and accept the Ambassador Agreement to continue.",
      },

      data: {
        type: "exclusive_ambassador_invitation",
        pageType: "WebView",
        agreementUrl: agreementUrl,
        userId: invitedUser._id.toString(),
      },
    };

    console.log(
      "[sendAmbassadorInvitationNotification] Sending payload",
      payload,
    );

    const response = await admin.messaging().sendEachForMulticast(payload);

    console.log("[sendAmbassadorInvitationNotification] Result", {
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
    });

    console.log(
      `✅ Ambassador invitation notification sent to ${invitedUser.name}`,
    );
  } catch (err) {
    console.error(
      "❌ sendAmbassadorInvitationNotification:",
      err.message,
    );
  }
}
// async function notifyServiceOwnerOnSubscription({ buyerId, serviceId }) {
//   try {
//     const buyer = await User.findById(buyerId);
//     const service = await Service.findById(serviceId).populate("owner");

//     if (!buyer || !service || !service.owner) return;

//     const owner = service.owner;

//     // ❌ No FCM token → skip
//     if (!owner.fcmToken?.length) return;

//     const payload = {
//       tokens: owner.fcmToken,
//       notification: {
//         title: "🎉 New Subscription",
//         body: `${buyer.name} subscribed to your service "${service.title}".`,
//         image: buyer.profile_image || service.image || "",
//       },
//       data: {
//         type: "ServiceSubscription",
//         pageType: "ServiceDetail",
//         serviceId: service._id.toString(),
//         buyerId: buyer._id.toString(),
//       },
//     };

//     const response = await admin.messaging().sendEachForMulticast(payload);

//     console.log(
//       `📩 Subscription notification sent to service owner (${owner.name}):`,
//       response.successCount,
//       "success",
//     );
//   } catch (err) {
//     console.error("❌ notifyServiceOwnerOnSubscription error:", err.message);
//   }
// }
// ------------------------------------------------------------------
// SERVICE REQUEST NOTIFICATIONS ("I need X" posts)
// ------------------------------------------------------------------
const SERVICE_REQUEST_RADIUS_KM = 30;
const SERVICE_REQUEST_MAX_NOTIFIED = 50;

function buildServiceRequestMessage(request, ownerName, distance) {
  return {
    title: "🙋 Someone near you needs help",
    body: `${ownerName} is looking for "${request.title}" (${distance.toFixed(
      1,
    )} km away)`,
  };
}

async function notifyNearbyUsersForRequest(request) {
  try {
    console.log(
      `🚀 Starting notification for service request "${request.title}"`,
    );

    const owner = await User.findById(request.owner).select(
      "name email profile_image",
    );
    const ownerName = owner?.name || "Someone";

    // Broaden the match with the request's category name/tags — same
    // expansion getInterestedUsers() does for category-based search.
    let matchTags = Array.isArray(request.tags) ? [...request.tags] : [];
    if (request.category) {
      const category = await Category.findById(request.category).select(
        "name tags",
      );
      if (category) {
        if (category.name) matchTags.push(category.name);
        if (Array.isArray(category.tags)) matchTags.push(...category.tags);
      }
    }
    matchTags = [...new Set(matchTags.map((t) => String(t).toLowerCase()))];

    if (!matchTags.length) {
      console.log(
        "⚠️ Service request has no tags/category to match — skipping notification fan-out",
      );
      return 0;
    }

    const candidates = await User.find({
      interests: { $in: matchTags },
      is_active: true,
      _id: { $ne: request.owner },
    });

    console.log(
      `Found ${candidates.length} active users with matching interests`,
    );

    // Compute distance for everyone in range, then cap the fan-out to the
    // nearest N so one popular tag near a dense city can't blast hundreds
    // of push notifications.
    const [reqLng, reqLat] = request.location.coordinates;
    const inRange = [];
    for (const user of candidates) {
      if (!user.fcmToken?.length) continue;
      if (!user.lastLocation?.coords?.coordinates) continue;

      const dist = getDistanceFromLatLonInKm(
        reqLat,
        reqLng,
        user.lastLocation.coords.coordinates[1],
        user.lastLocation.coords.coordinates[0],
      );

      if (dist > SERVICE_REQUEST_RADIUS_KM) continue;

      inRange.push({ user, dist });
    }

    inRange.sort((a, b) => a.dist - b.dist);
    const toNotify = inRange.slice(0, SERVICE_REQUEST_MAX_NOTIFIED);

    let notifiedUsers = [];

    for (const { user, dist } of toNotify) {
      const key = `sr-${user._id}-${request._id}`;
      if (!global.notifiedMap) global.notifiedMap = {};
      if (global.notifiedMap[key]) {
        console.log(
          `⏱ Already notified ${user.name} for this request, skipping`,
        );
        continue;
      }

      const message = buildServiceRequestMessage(request, ownerName, dist);
      const payload = {
        tokens: user.fcmToken,
        notification: { title: message.title, body: message.body },
        data: {
          type: "ServiceRequest",
          pageType: "ServiceRequestDetailsPage",
          requestId: request._id.toString(),
          requestTitle: request.title || "",
          ownerId: request.owner.toString(),
          ownerName: ownerName,
          ownerEmail: owner?.email || "",
          ownerProfileImage: owner?.profile_image || "",
          distanceKm: dist.toFixed(1),
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
          `❌ Failed to send request notification to ${user.name}:`,
          err.message,
        );
      }
    }

    console.log(
      `🎯 Finished notification for service request "${request.title}"`,
    );
    console.log(`📣 Total users notified: ${notifiedUsers.length}`);
    if (notifiedUsers.length > 0)
      console.log(`Users notified: ${notifiedUsers.join(", ")}`);

    return notifiedUsers.length;
  } catch (err) {
    console.error(
      `❌ Notification error for service request "${request.title}":`,
      err.message,
    );
    return 0;
  }
}

// =====================================================================
// SINGLE-RECIPIENT NOTIFICATIONS — Offer / Join / Quotation Change
// (client-finalized 24 Sep 2026 Service Request booking flow)
// Same sendEachForMulticast payload shape as the broadcast functions
// above, just targeted at exactly one user instead of a radius search —
// extracted into one helper so the 6 call sites below don't duplicate it.
// =====================================================================
async function sendUserNotification(user, title, body, data = {}) {
  try {
    if (!user?.fcmToken?.length) {
      console.log(`⚠️ No fcmToken for user ${user?._id} — skipping notification`);
      return false;
    }
    const payload = {
      tokens: user.fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v ?? "")]),
      ),
    };
    const response = await admin.messaging().sendEachForMulticast(payload);
    response.responses.forEach((res, index) => {
      const token = payload.tokens[index];
      if (res.success) console.log(`✅ Sent to token: ${token}`);
      else console.log(`❌ Failed for token: ${token} - ${res.error?.message}`);
    });
    return true;
  } catch (err) {
    console.error(`❌ sendUserNotification error for user ${user?._id}:`, err.message);
    return false;
  }
}

async function notifyNewOffer(request, offer) {
  const owner = await User.findById(request.owner).select("fcmToken");
  const provider = await User.findById(offer.provider).select("name");
  if (!owner) return;
  await sendUserNotification(
    owner,
    "💬 New Offer received",
    `${provider?.name || "A provider"} offered ${offer.currency || ""} ${offer.amount} for "${request.title}"`,
    {
      type: "ServiceRequestOffer",
      pageType: "ServiceRequestOffersPage",
      requestId: request._id,
      offerId: offer._id,
    },
  );
}

async function notifyOfferAccepted(request, offer) {
  const provider = await User.findById(offer.provider).select("fcmToken");
  if (!provider) return;
  await sendUserNotification(
    provider,
    "🎉 Your Offer was accepted",
    `Your offer of ${offer.currency || ""} ${offer.amount} for "${request.title}" was accepted`,
    {
      type: "ServiceRequestOffer",
      pageType: "ServiceRequestOffersPage",
      requestId: request._id,
      offerId: offer._id,
    },
  );
}

async function notifyOfferDeclined(request, offer) {
  const provider = await User.findById(offer.provider).select("fcmToken");
  if (!provider) return;
  await sendUserNotification(
    provider,
    "Offer not selected this time",
    `Your offer for "${request.title}" was not selected — another provider was chosen`,
    {
      type: "ServiceRequestOffer",
      pageType: "ServiceRequestOffersPage",
      requestId: request._id,
      offerId: offer._id,
    },
  );
}

async function notifyGroupFilled(request) {
  const owner = await User.findById(request.owner).select("fcmToken");
  if (!owner) return;
  await sendUserNotification(
    owner,
    "✅ Your request is full",
    `"${request.title}" has reached its required participants`,
    {
      type: "ServiceRequest",
      pageType: "ServiceRequestDetailsPage",
      requestId: request._id,
    },
  );
}

async function notifyOfferWithdrawn(request, offer) {
  const owner = await User.findById(request.owner).select("fcmToken");
  const provider = await User.findById(offer.provider).select("name");
  if (!owner) return;
  await sendUserNotification(
    owner,
    "↩️ Offer Withdrawn",
    `${provider?.name || "A provider"} withdrew their offer on "${request.title}"`,
    {
      type: "ServiceRequest",
      pageType: "ServiceRequestDetailsPage",
      requestId: request._id,
      offerId: offer._id,
    },
  );
}

// =====================================================================
// SERVICE REQUEST BOOKING CANCELLED — kept separate from the normal
// "Service Cancelled" push so the app can tell it's a request booking and
// who cancelled it. Each side gets its own wording:
//   free join  → booking.customer = the participant, booking.provider = the
//                request owner (host)
//   paid       → booking.customer = customer, booking.provider = provider
// data.type = "request_booking_cancelled" for every one of them.
// =====================================================================
async function notifyRequestBookingCancelled({
  booking,
  customer,
  provider,
  request,
  cancelledBy,
  byAdmin = false,
  reason = "",
  refundAmount = 0,
  cancellationFee = 0,
  providerFeeShare = 0,
  currency = "",
}) {
  const title = request?.title || "your request";
  const isFree = !booking.amount;
  const money = (n) => `${Number(n || 0)} ${String(currency || "").toUpperCase()}`.trim();
  const customerCancelled = cancelledBy !== "provider";
  const by = byAdmin ? "BeTogether support" : null;

  let toCustomer;
  let toProvider;
  if (isFree) {
    toCustomer = customerCancelled
      ? ["You left the request", `You cancelled your spot in "${title}".`]
      : [
          "❌ Request cancelled by host",
          `${by || provider.name} cancelled your spot in "${title}".`,
        ];
    toProvider = customerCancelled
      ? ["👋 A participant left", `${customer.name} cancelled their spot in your request "${title}".`]
      : by
        ? ["❌ Participant removed", `${by} removed ${customer.name} from your request "${title}".`]
        : ["Participant removed", `You cancelled ${customer.name}'s spot in "${title}".`];
  } else if (customerCancelled) {
    toCustomer = [
      "Request booking cancelled",
      cancellationFee > 0
        ? `You cancelled "${title}". Refund: ${money(refundAmount)} (late cancellation fee ${money(cancellationFee)}).`
        : `You cancelled "${title}". Full refund: ${money(refundAmount)}.`,
    ];
    toProvider = [
      "❌ Request booking cancelled by customer",
      providerFeeShare > 0
        ? `${customer.name} cancelled "${title}". You'll receive ${money(providerFeeShare)} from the late cancellation fee.`
        : `${customer.name} cancelled "${title}".`,
    ];
  } else {
    toCustomer = [
      by ? "❌ Request booking cancelled" : "❌ Request booking cancelled by provider",
      `${by || provider.name} cancelled "${title}". You'll get a full refund of ${money(refundAmount)}.`,
    ];
    toProvider = by
      ? ["❌ Request booking cancelled", `${by} cancelled "${title}". The customer gets a full refund.`]
      : ["Request booking cancelled", `You cancelled "${title}". The customer gets a full refund.`];
  }

  const data = {
    type: "request_booking_cancelled",
    pageType: "BookingDetailsPage",
    bookingId: booking._id,
    serviceRequestId: request?._id || booking.serviceRequest,
    requestMode: request?.requestMode || "",
    cancelledBy: byAdmin ? "admin" : cancelledBy,
    reason,
    refundAmount,
    cancellationFee,
  };

  await sendUserNotification(customer, toCustomer[0], toCustomer[1], {
    ...data,
    userType: "customer",
  });
  await sendUserNotification(provider, toProvider[0], toProvider[1], {
    ...data,
    userType: "provider",
  });
}

async function notifyQuotationChangeSubmitted(quotationChange, booking) {
  const customer = await User.findById(booking.customer).select("fcmToken");
  if (!customer) return;
  await sendUserNotification(
    customer,
    "📝 Updated price proposed",
    `The provider proposed a new price: ${quotationChange.proposedAmount} (was ${quotationChange.previousAmount})`,
    {
      type: "QuotationChange",
      pageType: "BookingDetailsPage",
      bookingId: booking._id,
      quotationChangeId: quotationChange._id,
    },
  );
}

async function notifyQuotationChangeResponded(quotationChange, booking) {
  const provider = await User.findById(booking.provider).select("fcmToken");
  if (!provider) return;
  const accepted = quotationChange.status === "accepted";
  await sendUserNotification(
    provider,
    accepted ? "✅ Price change accepted" : "Price change rejected",
    accepted
      ? `The customer accepted the new price of ${quotationChange.proposedAmount}`
      : `The customer rejected the new price of ${quotationChange.proposedAmount}`,
    {
      type: "QuotationChange",
      pageType: "BookingDetailsPage",
      bookingId: booking._id,
      quotationChangeId: quotationChange._id,
    },
  );
}

// =====================================================================
// REPORT RESOLUTION — push notification to the reported user once admin
// takes an action (warn/restrict/block). Not sent for "dismiss" (nothing
// happened) or "refund" (that's between the customer and admin, not a
// notice about the reported user's own account standing).
// =====================================================================
async function notifyReportOutcome(user, adminAction, notes) {
  if (!user) return;
  const titles = {
    warned: "⚠️ Account Warning",
    restricted: "🚫 Account Temporarily Restricted",
    blocked: "⛔ Account Blocked",
  };
  const bodies = {
    warned:
      "You've received a warning following a reported incident. Repeated issues may lead to a temporary or permanent restriction.",
    restricted:
      "Your account has been restricted for 7 days due to a reported incident.",
    blocked: "Your account has been blocked due to a reported incident.",
  };
  const title = titles[adminAction];
  const body = bodies[adminAction];
  if (!title || !body) return;
  await sendUserNotification(user, title, notes ? `${body} (${notes})` : body, {
    type: "report_outcome",
    adminAction,
  });
}

// =====================================================================
// PAYMENT FAILED — one shared helper for every place a Stripe charge can
// fail: a Service booking, a Service-Request booking (paid_fixed/
// paid_offer — same Payment model, same webhook case), and a Promotion
// subscription renewal. Kept as a single function so the wording never
// drifts between the three call sites, and so a future 4th payment type
// gets this for free.
// =====================================================================
async function notifyPaymentFailed(user, itemTitle, amount, currency, reason) {
  if (!user) return;
  const amountLabel =
    amount !== null && amount !== undefined
      ? `${currency ? currency + " " : ""}${amount}`
      : null;
  const body = reason
    ? `Your payment${amountLabel ? ` of ${amountLabel}` : ""} for "${itemTitle}" failed: ${reason}. Please try again or use a different payment method.`
    : `Your payment${amountLabel ? ` of ${amountLabel}` : ""} for "${itemTitle}" could not be processed. Please try again or use a different payment method.`;
  await sendUserNotification(user, "❌ Payment Failed", body, {
    type: "payment_failed",
    itemTitle,
  });
}

// =====================================================================
// WALLET COINS — one shared helper for every place points get credited or
// debited: referral rewards (signup-time AND first-booking/first-service
// milestones), coins actually spent on a completed booking, and coins
// refunded back after a cancellation. Keyed by the exact same `type`
// string already used on the WalletHistory record, so adding a new coin
// event later only means adding one entry to this map.
// =====================================================================
const WALLET_NOTICES = {
  referral_inviter_bonus: {
    title: "🎁 Referral Reward!",
    body: (points) => `You earned ${points} coins — a friend joined Betogether using your referral code!`,
  },
  referral_invited_bonus: {
    title: "🎉 Welcome Bonus!",
    body: (points) => `You earned ${points} coins for joining with a referral code!`,
  },
  referral_booking_bonus: {
    title: "🎁 Referral Reward!",
    body: (points) => `You earned ${points} coins — your referred friend just completed their first booking!`,
  },
  referral_service_bonus: {
    title: "🎁 Referral Reward!",
    body: (points) => `You earned ${points} coins — your referred friend just posted their first service!`,
  },
  wallet_spent: {
    title: "🪙 Wallet Coins Used",
    body: (points) => `${points} coins were deducted from your wallet for your recent booking.`,
  },
  wallet_refund: {
    title: "🪙 Coins Refunded",
    body: (points) => `${points} coins have been refunded to your wallet after your booking was cancelled.`,
  },
};

async function notifyWalletTransaction(user, type, points) {
  if (!user) return;
  const notice = WALLET_NOTICES[type];
  if (!notice) return;
  await sendUserNotification(user, notice.title, notice.body(Math.abs(points)), {
    type: "wallet_transaction",
    walletEventType: type,
    points: Math.abs(points),
  });
}

// =====================================================================
// PROMOTION / SUBSCRIPTION — purchase confirmation, renewal, expiring-soon
// reminder, and expired notice, all sent to the service owner.
// =====================================================================
async function notifyPromotionPurchased(user, serviceTitle, endDate) {
  if (!user) return;
  await sendUserNotification(
    user,
    "🚀 Promotion Activated!",
    `Your promotion for "${serviceTitle}" is now live until ${formatDateTime(endDate)}. Enjoy boosted visibility!`,
    { type: "promotion_purchased", serviceTitle },
  );
}

async function notifyPromotionRenewed(user, serviceTitle, endDate) {
  if (!user) return;
  await sendUserNotification(
    user,
    "✅ Promotion Renewed",
    `Your promotion for "${serviceTitle}" has been renewed and is active until ${formatDateTime(endDate)}.`,
    { type: "promotion_renewed", serviceTitle },
  );
}

async function notifyPromotionExpiringSoon(user, serviceTitle, endDate) {
  if (!user) return;
  await sendUserNotification(
    user,
    "⏳ Promotion Expiring Soon",
    `Your promotion for "${serviceTitle}" expires on ${formatDateTime(endDate)}. Renew now to keep your boosted visibility.`,
    { type: "promotion_expiring_soon", serviceTitle },
  );
}

async function notifyPromotionExpired(user, serviceTitle) {
  if (!user) return;
  await sendUserNotification(
    user,
    "🔴 Promotion Expired",
    `Your promotion for "${serviceTitle}" has expired. Renew it to get boosted visibility again.`,
    { type: "promotion_expired", serviceTitle },
  );
}

// =====================================================================
// NEW REVIEW — push notification to the provider when a customer reviews
// their completed booking.
// =====================================================================
async function notifyNewReview(provider, rating, text) {
  if (!provider) return;
  const body = text
    ? `You received a ${rating}-star review: "${text}"`
    : `You received a ${rating}-star review!`;
  await sendUserNotification(provider, "⭐ New Review!", body, {
    type: "new_review",
    rating,
  });
}

// =====================================================================
// REPORT SUBMITTED / RESOLVED — sent to the REPORTER (not the reported
// party — that's notifyReportOutcome above). Covers both report types
// (type:"service" and type:"user") with the same two functions.
// =====================================================================
async function notifyReportReceived(reporter) {
  if (!reporter) return;
  await sendUserNotification(
    reporter,
    "📩 Report Received",
    "Your report has been received and is under review by our team. We'll take appropriate action shortly.",
    { type: "report_received" },
  );
}

function buildReporterResolutionMessage(reportType, outcome) {
  if (reportType === "service") {
    return outcome === "approved"
      ? "Your report has been reviewed — the reported service has been removed. Thank you for helping keep Betogether safe."
      : "Your report has been reviewed. We didn't find a violation this time, but thank you for flagging it.";
  }
  // reportType === "user"
  if (outcome === "dismissed") {
    return "Your report has been reviewed and closed — no violation was found.";
  }
  return "Your report has been reviewed and appropriate action has been taken. Thank you for helping keep Betogether safe.";
}

async function notifyReporterOnResolution(reporter, reportType, outcome) {
  if (!reporter) return;
  await sendUserNotification(
    reporter,
    "✅ Your Report Was Reviewed",
    buildReporterResolutionMessage(reportType, outcome),
    { type: "report_resolved", reportType, outcome },
  );
}

// =====================================================================
// REQUEST EXPIRING SOON, ZERO RESPONSE — heads-up to the request owner so
// they can adjust price/details before it lapses with nobody having
// booked/offered/joined at all.
// =====================================================================
async function notifyRequestExpiringNoResponse(owner, requestTitle) {
  if (!owner) return;
  await sendUserNotification(
    owner,
    "⏰ Your Request is Expiring Soon",
    `Your request "${requestTitle}" expires soon and hasn't received any response yet. Consider adjusting your budget or details to attract more interest.`,
    { type: "request_expiring_no_response", requestTitle },
  );
}

// =====================================================================
// DIRECT ADMIN BLOCK/UNBLOCK — Admin.js's blockUser/unblockUser act outside
// the Reports flow (no linked report, no "reported incident" wording), so
// these use plainer copy than notifyReportOutcome above.
// =====================================================================
// =====================================================================
// AMBASSADOR WITHDRAWAL — success/failure of a payout request.
// =====================================================================
// =====================================================================
// PASSWORD CHANGED — security notice, sent right after a successful
// password reset so the account owner notices immediately if it wasn't
// actually them.
// =====================================================================
async function notifyPasswordChanged(user) {
  if (!user) return;
  await sendUserNotification(
    user,
    "🔒 Password Changed",
    "Your password was just changed. If this wasn't you, please contact support immediately.",
    { type: "password_changed" },
  );
}

async function notifyAmbassadorWithdrawalSuccess(user, amount) {
  if (!user) return;
  await sendUserNotification(
    user,
    "💸 Withdrawal Successful",
    `Your withdrawal of €${amount} is being processed and will arrive in your bank account soon.`,
    { type: "ambassador_withdrawal_success", amount },
  );
}

async function notifyAmbassadorWithdrawalFailed(user, amount) {
  if (!user) return;
  await sendUserNotification(
    user,
    "❌ Withdrawal Failed",
    `Your withdrawal of €${amount} could not be processed. The amount has been returned to your wallet — please try again.`,
    { type: "ambassador_withdrawal_failed", amount },
  );
}

async function notifyAccountBlocked(user) {
  if (!user) return;
  await sendUserNotification(
    user,
    "⛔ Account Blocked",
    "Your account has been blocked by admin. Please contact support if you believe this is a mistake.",
    { type: "account_blocked" },
  );
}

async function notifyAccountUnblocked(user) {
  if (!user) return;
  await sendUserNotification(
    user,
    "✅ Account Restored",
    "Good news — your account has been unblocked and is active again. Welcome back!",
    { type: "account_unblocked" },
  );
}

async function notifyPromotionCancelled(user, serviceTitle) {
  if (!user) return;
  await sendUserNotification(
    user,
    "🛑 Promotion Cancelled",
    `Your promotion for "${serviceTitle}" has been cancelled. Your service has returned to normal listing.`,
    { type: "promotion_cancelled", serviceTitle },
  );
}

// Exports
exports.sendUserNotification = sendUserNotification;
exports.notifyReportOutcome = notifyReportOutcome;
exports.notifyPaymentFailed = notifyPaymentFailed;
exports.notifyWalletTransaction = notifyWalletTransaction;
exports.notifyPromotionPurchased = notifyPromotionPurchased;
exports.notifyPromotionRenewed = notifyPromotionRenewed;
exports.notifyPromotionCancelled = notifyPromotionCancelled;
exports.notifyPromotionExpiringSoon = notifyPromotionExpiringSoon;
exports.notifyPromotionExpired = notifyPromotionExpired;
exports.notifyNewReview = notifyNewReview;
exports.notifyReportReceived = notifyReportReceived;
exports.notifyReporterOnResolution = notifyReporterOnResolution;
exports.notifyAccountBlocked = notifyAccountBlocked;
exports.notifyAccountUnblocked = notifyAccountUnblocked;
exports.notifyAmbassadorWithdrawalSuccess = notifyAmbassadorWithdrawalSuccess;
exports.notifyAmbassadorWithdrawalFailed = notifyAmbassadorWithdrawalFailed;
exports.notifyPasswordChanged = notifyPasswordChanged;
exports.notifyRequestExpiringNoResponse = notifyRequestExpiringNoResponse;
exports.notifyNewOffer = notifyNewOffer;
exports.notifyOfferAccepted = notifyOfferAccepted;
exports.notifyOfferDeclined = notifyOfferDeclined;
exports.notifyOfferWithdrawn = notifyOfferWithdrawn;
exports.notifyGroupFilled = notifyGroupFilled;
exports.notifyQuotationChangeSubmitted = notifyQuotationChangeSubmitted;
exports.notifyQuotationChangeResponded = notifyQuotationChangeResponded;
exports.notifyRequestBookingCancelled = notifyRequestBookingCancelled;
exports.notifyOnNewServiceRequest = notifyNearbyUsersForRequest;
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
module.exports.sendAmbassadorApprovedNotification =
  sendAmbassadorApprovedNotification;
module.exports.sendAmbassadorRemovedNotification =
  sendAmbassadorRemovedNotification;
module.exports.sendAmbassadorRejectedNotification =
  sendAmbassadorRejectedNotification;
module.exports.sendExclusiveAmbassadorInvitationNotification =
  sendExclusiveAmbassadorInvitationNotification;
  module.exports.sendAmbassadorInvitationNotification=sendAmbassadorInvitationNotification
module.exports.sendAmbassadorInvitationReminderNotification = sendAmbassadorInvitationReminderNotification;
module.exports.notifyAmbassadorInvitationExpired = notifyAmbassadorInvitationExpired;
//module.exports.notifyOnServiceSubscription = notifyServiceOwnerOnSubscription;
//module.exports.notifyServiceOwnerOnSubscription = notifyServiceOwnerOnSubscription;
//notificaton addd
//module.exports.notifyServiceOwnerOnSubscription = notifyServiceOwnerOnSubscription;
//notificaton addd
