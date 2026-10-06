// =====================================================================
// AMBASSADOR INVITATIONS — reminder + expiry (rules in
// utils/ambassadorInvitation.js)
//   every 24h unanswered → a reminder push to the invited user (days 1–6)
//   3 days unanswered    → one reminder email (the pushes carry on daily)
//   7 days unanswered    → status "expired": the user stays a normal user, the
//                       admin's "Send Invitation" button shows again, and an
//                       exclusive ambassador who sent it is told it lapsed
// Runs every hour. At most one push per 24h and one email per invitation;
// after downtime only the latest due push goes out, never a burst.
// =====================================================================
const cron = require("node-cron");
const PendingAmbassadorAssignment = require("../model/PendingAmbassadorAssignment");
const User = require("../model/User");
const {
  INVITATION_PUSH_EVERY,
  INVITATION_REMINDER_AFTER,
  INVITATION_VALID_FOR,
  invitationExpiresAt,
} = require("../utils/ambassadorInvitation");
const {
  sendAmbassadorInvitationReminderNotification,
  notifyAmbassadorInvitationExpired,
} = require("../controller/notificationController");
const { sendAmbassadorInvitationReminderEmail } = require("../utils/email");

const log = (msg, data = {}) => console.log(`[AmbassadorInvitation] ${msg}`, data);

async function runAmbassadorInvitationJobs(now = new Date()) {
  const expireBefore = new Date(now.getTime() - INVITATION_VALID_FOR);
  const remindBefore = new Date(now.getTime() - INVITATION_REMINDER_AFTER);

  // ---- 7 days: expire ----
  const lapsed = await PendingAmbassadorAssignment.find({
    status: "pending",
    createdAt: { $lte: expireBefore },
  }).select("_id user createdByUser assignmentSource");

  let expired = 0;
  for (const invitation of lapsed) {
    const res = await PendingAmbassadorAssignment.updateOne(
      { _id: invitation._id, status: "pending" },
      { $set: { status: "expired" } },
    );
    if (!res.modifiedCount) continue;
    expired++;

    if (invitation.assignmentSource === "exclusive" && invitation.createdByUser) {
      const [inviter, invitedUser] = await Promise.all([
        User.findById(invitation.createdByUser).select("fcmToken"),
        User.findById(invitation.user).select("name"),
      ]);
      if (inviter) {
        notifyAmbassadorInvitationExpired(inviter, invitedUser).catch((err) =>
          log("expired notification failed", { error: err.message }),
        );
      }
    }
  }

  // The invited user, or null if they can't be reminded any more.
  const loadInvitedUser = async (invitation) => {
    const user = await User.findById(invitation.user).select("name email fcmToken isAmbassador");
    return user && !user.isAmbassador ? user : null;
  };

  // ---- every 24h: reminder push ----
  const open = await PendingAmbassadorAssignment.find({
    status: "pending",
    createdAt: { $lte: new Date(now.getTime() - INVITATION_PUSH_EVERY), $gt: expireBefore },
  });

  let pushed = 0;
  for (const invitation of open) {
    try {
      const age = now - new Date(invitation.createdAt);
      const daysElapsed = Math.floor(age / INVITATION_PUSH_EVERY);
      const sent = invitation.pushRemindersSent || 0;
      if (daysElapsed <= sent) continue;

      // Claim this day's push first so an overlapping run can't send it twice.
      const claimed = await PendingAmbassadorAssignment.updateOne(
        {
          _id: invitation._id,
          status: "pending",
          $or: [
            { pushRemindersSent: { $lt: daysElapsed } },
            { pushRemindersSent: { $exists: false } },
          ],
        },
        { $set: { pushRemindersSent: daysElapsed } },
      );
      if (!claimed.modifiedCount) continue;

      const user = await loadInvitedUser(invitation);
      if (!user) continue;

      const expiresAt = invitationExpiresAt(invitation);
      const daysLeft = Math.max(1, Math.ceil((expiresAt - now) / INVITATION_PUSH_EVERY));
      await sendAmbassadorInvitationReminderNotification(user, expiresAt, daysLeft);
      pushed++;
    } catch (err) {
      log("push error", { invitationId: invitation._id, error: err.message });
    }
  }

  // ---- 3 days: one reminder email ----
  const waiting = await PendingAmbassadorAssignment.find({
    status: "pending",
    reminderSentAt: null,
    createdAt: { $lte: remindBefore, $gt: expireBefore },
  });

  let reminded = 0;
  for (const invitation of waiting) {
    try {
      // Claim first so an overlapping run can't email twice.
      const claimed = await PendingAmbassadorAssignment.updateOne(
        { _id: invitation._id, status: "pending", reminderSentAt: null },
        { $set: { reminderSentAt: now } },
      );
      if (!claimed.modifiedCount) continue;

      const [user, inviter] = await Promise.all([
        loadInvitedUser(invitation),
        invitation.createdByUser
          ? User.findById(invitation.createdByUser).select("name")
          : null,
      ]);
      if (!user) continue;

      await sendAmbassadorInvitationReminderEmail(user, invitation, {
        inviterName: inviter?.name || "BeTogether",
        expiresAt: invitationExpiresAt(invitation),
      });
      reminded++;
    } catch (err) {
      log("email error", { invitationId: invitation._id, error: err.message });
    }
  }

  if (expired || pushed || reminded) log("run finished", { pushed, reminded, expired });
  return { pushed, reminded, expired };
}

// Every hour, at minute 45.
cron.schedule("45 * * * *", () => {
  runAmbassadorInvitationJobs().catch((err) => log("cron error", { error: err.message }));
});
console.log("🕐 Ambassador invitation reminder/expiry cron scheduled (every hour)");

module.exports = { runAmbassadorInvitationJobs };
