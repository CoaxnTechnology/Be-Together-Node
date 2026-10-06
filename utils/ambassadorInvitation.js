// Ambassador invitation lifetime — one rule used by the reminder/expiry cron,
// accept, decline, the admin user list and the user's profile, so all of
// them agree on whether an invitation is still open.
//   3 days without an answer → one reminder (push + email)
//   7 days without an answer → expired; the user stays a normal user and
//                               the admin can send a new invitation
// Counted from createdAt (older invitations stored a 24h expiresAt that was
// never enforced, so it isn't trusted here).
const DAY = 24 * 60 * 60 * 1000;

const INVITATION_REMINDER_AFTER = 3 * DAY;
const INVITATION_VALID_FOR = 7 * DAY;

function invitationExpiresAt(invitation) {
  return new Date(new Date(invitation.createdAt).getTime() + INVITATION_VALID_FOR);
}

function isInvitationExpired(invitation, now = new Date()) {
  return invitation?.status === "pending" && invitationExpiresAt(invitation) <= now;
}

// Mongo filter for invitations that are still open right now.
function openInvitationFilter(now = new Date()) {
  return {
    status: "pending",
    createdAt: { $gt: new Date(now.getTime() - INVITATION_VALID_FOR) },
  };
}

module.exports = {
  INVITATION_REMINDER_AFTER,
  INVITATION_VALID_FOR,
  invitationExpiresAt,
  isInvitationExpired,
  openInvitationFilter,
};
