// =====================================================================
// AMBASSADOR INVITATIONS — reminder + expiry (rules in
// utils/ambassadorInvitation.js)
//   3 days unanswered → one reminder to the invited user (push + email)
//   7 days unanswered → status "expired": the user stays a normal user, the
//                       admin's "Send Invitation" button shows again, and an
//                       exclusive ambassador who sent it is told it lapsed
// Runs every hour. Each invitation is reminded at most once.
// =====================================================================
const cron = require("node-cron");
const PendingAmbassadorAssignment = require("../model/PendingAmbassadorAssignment");
const User = require("../model/User");
const {
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

  // ---- 3 days: one reminder ----
  const waiting = await PendingAmbassadorAssignment.find({
    status: "pending",
    reminderSentAt: null,
    createdAt: { $lte: remindBefore, $gt: expireBefore },
  });

  let reminded = 0;
  for (const invitation of waiting) {
    try {
      // Claim first so an overlapping run can't remind twice.
      const claimed = await PendingAmbassadorAssignment.updateOne(
        { _id: invitation._id, status: "pending", reminderSentAt: null },
        { $set: { reminderSentAt: now } },
      );
      if (!claimed.modifiedCount) continue;

      const [user, inviter] = await Promise.all([
        User.findById(invitation.user).select("name email fcmToken isAmbassador"),
        invitation.createdByUser
          ? User.findById(invitation.createdByUser).select("name")
          : null,
      ]);
      if (!user || user.isAmbassador) continue;

      const expiresAt = invitationExpiresAt(invitation);
      await sendAmbassadorInvitationReminderNotification(user, expiresAt).catch((err) =>
        log("reminder push failed", { error: err.message }),
      );
      await sendAmbassadorInvitationReminderEmail(user, invitation, {
        inviterName: inviter?.name || "BeTogether",
        expiresAt,
      }).catch((err) => log("reminder email failed", { error: err.message }));
      reminded++;
    } catch (err) {
      log("error", { invitationId: invitation._id, error: err.message });
    }
  }

  if (expired || reminded) log("run finished", { reminded, expired });
  return { reminded, expired };
}

// Every hour, at minute 45.
cron.schedule("45 * * * *", () => {
  runAmbassadorInvitationJobs().catch((err) => log("cron error", { error: err.message }));
});
console.log("🕐 Ambassador invitation reminder/expiry cron scheduled (every hour)");

module.exports = { runAmbassadorInvitationJobs };
