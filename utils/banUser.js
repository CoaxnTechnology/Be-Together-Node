// Shared ban logic — used by both the direct admin "Block User" action
// (controller/Admin.js) and the "user" report resolve action
// (controller/serviceReport.controller.js's resolveUserReport), so the two
// never drift apart. Pass `bannedUntil` for a temporary ban (e.g. 7 days from
// a report resolution); leave it null for a permanent block.
async function banUser(user, { bannedUntil = null } = {}) {
  user.status = "banned";
  user.is_active = false;

  // kill all sessions / mobile push logout
  user.session_id = null;
  user.access_token = null;
  user.fcmToken = [];

  user.bannedUntil = bannedUntil;

  await user.save();
  return user;
}

// Self-heals a temporary ban once it's expired — call this right before any
// `status === "banned"` check (authMiddleware, authController's login/OTP
// checks) so a 7-day restriction lifts on its own on the next request,
// without needing a cron job. A permanent block never sets `bannedUntil`, so
// this never fires for one.
async function liftExpiredBan(user) {
  if (
    user.status === "banned" &&
    user.bannedUntil &&
    user.bannedUntil <= new Date()
  ) {
    user.status = "active";
    user.is_active = true;
    user.bannedUntil = null;
    await user.save();
    return true;
  }
  return false;
}

module.exports = { banUser, liftExpiredBan };
