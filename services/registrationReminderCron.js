// =====================================================================
// UNFINISHED REGISTRATION — reminders + cleanup
//
// A manual sign-up stays "pending_verification" until the email OTP is
// verified. Counted from the person's LAST activity on the sign-up
// (register / login attempt / resend OTP — authController resets the clock):
//   24 hours → reminder #1  "Complete your registration"
//   3 days   → reminder #2  "Your registration is still incomplete"
//   7 days   → reminder #3  "Complete your BeTogether account"
//   30 days  → reminder #4  final reminder, with the removal date
//   90 days  → the unfinished account is deleted (+ a "removed" email)
// Runs every hour. Each reminder is sent once; if the server was down and
// several are due, only the latest one goes out — never a burst of emails.
// =====================================================================
const cron = require("node-cron");
const User = require("../model/User");
const Wallet = require("../model/Wallet");
const Booking = require("../model/Booking");
const Payment = require("../model/Payment");
const Service = require("../model/Service");
const ServiceRequest = require("../model/ServiceRequest");
const ServiceRequestOffer = require("../model/ServiceRequestOffer");
const {
  sendRegistrationReminderEmail,
  sendRegistrationRemovedEmail,
} = require("../utils/email");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const REMINDER_STAGES = [
  { stage: 1, after: 1 * DAY },
  { stage: 2, after: 3 * DAY },
  { stage: 3, after: 7 * DAY },
  { stage: 4, after: 30 * DAY },
];
const LAST_STAGE = REMINDER_STAGES[REMINDER_STAGES.length - 1].stage;
const DELETE_AFTER = 90 * DAY;
const BATCH_SIZE = 500;

const log = (msg, data = {}) => console.log(`[RegistrationReminder] ${msg}`, data);

// A pending account can't log in, so it should never own anything — but if
// it somehow does, it is never auto-deleted.
async function ownsAnything(userId) {
  const found = await Promise.all([
    Booking.exists({ $or: [{ customer: userId }, { provider: userId }] }),
    Payment.exists({ $or: [{ user: userId }, { provider: userId }] }),
    Service.exists({ owner: userId }),
    ServiceRequest.exists({ owner: userId }),
    ServiceRequestOffer.exists({ provider: userId }),
  ]);
  return found.some(Boolean);
}

async function runRegistrationReminders(now = new Date()) {
  const lastActivity = { $ifNull: ["$verificationActivityAt", "$created_at"] };
  const users = await User.find({
    status: "pending_verification",
    // Only email sign-ups waiting for their OTP. Google/Apple accounts are
    // verified by the provider (some were saved as "pending" by mistake) —
    // they must never get these emails or be deleted.
    register_type: "manual",
    otp_verified: { $ne: true },
    $expr: {
      $and: [
        // at least the first reminder is due…
        { $lte: [lastActivity, new Date(now - REMINDER_STAGES[0].after)] },
        // …and there is still something to do (a reminder or the deletion)
        {
          $or: [
            { $lt: [{ $ifNull: ["$verificationReminderStage", 0] }, LAST_STAGE] },
            { $lte: [lastActivity, new Date(now - DELETE_AFTER)] },
          ],
        },
      ],
    },
  })
    .select("name email created_at verificationActivityAt verificationReminderStage")
    .limit(BATCH_SIZE);

  let reminded = 0;
  let deleted = 0;

  for (const user of users) {
    try {
      // Accounts created before this feature have no activity date yet —
      // start their clock now (backdated one day, so reminder #1 goes out
      // first) instead of deleting a long-forgotten sign-up without warning.
      if (!user.verificationActivityAt) {
        const start = new Date(Math.max(new Date(user.created_at).getTime(), now - DAY));
        await User.updateOne(
          { _id: user._id, verificationActivityAt: null },
          { $set: { verificationActivityAt: start } },
        );
        user.verificationActivityAt = start;
      }

      const since = new Date(user.verificationActivityAt);
      const age = now - since;

      // ---- 90 days: remove the unfinished sign-up ----
      if (age >= DELETE_AFTER) {
        if (await ownsAnything(user._id)) {
          log("skipped delete — account has data", { userId: user._id });
          continue;
        }
        const removed = await User.findOneAndDelete({
          _id: user._id,
          status: "pending_verification",
          register_type: "manual",
          otp_verified: { $ne: true },
        });
        if (removed) {
          await Wallet.deleteMany({ user: removed._id });
          await sendRegistrationRemovedEmail(removed).catch((err) =>
            log("removed email failed", { userId: removed._id, error: err.message }),
          );
          deleted++;
          log("deleted unfinished sign-up", { userId: removed._id, email: removed.email });
        }
        continue;
      }

      // ---- reminders: only the latest one that's due ----
      const currentStage = user.verificationReminderStage || 0;
      const due = [...REMINDER_STAGES].reverse().find((s) => age >= s.after);
      if (!due || due.stage <= currentStage) continue;

      // Claim the stage before emailing, so an overlapping run can't send it twice.
      const claimed = await User.updateOne(
        {
          _id: user._id,
          status: "pending_verification",
          $or: [
            { verificationReminderStage: { $lt: due.stage } },
            { verificationReminderStage: { $exists: false } },
          ],
        },
        { $set: { verificationReminderStage: due.stage } },
      );
      if (!claimed.modifiedCount) continue;

      await sendRegistrationReminderEmail(
        user,
        due.stage,
        new Date(since.getTime() + DELETE_AFTER),
      );
      reminded++;
    } catch (err) {
      log("error", { userId: user._id, error: err.message });
    }
  }

  if (reminded || deleted) log("run finished", { reminded, deleted });
  return { reminded, deleted };
}

// Every hour, at minute 15.
cron.schedule("15 * * * *", () => {
  runRegistrationReminders().catch((err) => log("cron error", { error: err.message }));
});
console.log("🕐 Unfinished-registration reminder cron scheduled (every hour)");

module.exports = { runRegistrationReminders, REMINDER_STAGES, DELETE_AFTER };
