// READ-ONLY report on sign-ups still in "pending_verification".
// Changes nothing — no updates, no deletes, no emails.
// Paste the whole thing into MongoDB Compass → MONGOSH (bottom panel),
// after selecting the right database (e.g. `use betogether`).
(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const pending = { status: "pending_verification" };
  const users = db.getCollection("users");
  const line = () => print("-".repeat(70));
  const pad = (v, n) => String(v).padEnd(n);
  const daysAgo = (d) => Math.floor((now - new Date(d)) / DAY);

  print(`\nPENDING VERIFICATION REPORT — ${now.toISOString()}  (db: ${db.getName()})`);
  line();
  const total = users.countDocuments(pending);
  print(`Total users in pending_verification: ${total}`);
  print(`Total users (all statuses):          ${users.countDocuments({})}`);
  if (!total) return print("Nothing to report.");

  // 1) Time since registration
  line();
  print("1) Time since registration (created_at)");
  const labels = {
    0: "< 24 hours", 1: "1 - 3 days", 3: "3 - 7 days", 7: "7 - 30 days",
    30: "30 - 90 days", 90: "90 - 180 days (older than 3 months)",
    180: "180 - 365 days", 365: "> 1 year",
  };
  users.aggregate([
    { $match: pending },
    {
      $bucket: {
        groupBy: { $divide: [{ $subtract: [now, "$created_at"] }, DAY] },
        boundaries: [0, 1, 3, 7, 30, 90, 180, 365, 100000],
        default: "no created_at",
        output: { count: { $sum: 1 } },
      },
    },
  ]).forEach((b) => print(`   ${pad(labels[b._id] || b._id, 40)} ${b.count}`));
  const over90 = users.countDocuments({ ...pending, created_at: { $lte: new Date(now - 90 * DAY) } });
  const over1 = users.countDocuments({ ...pending, created_at: { $lte: new Date(now - DAY) } });
  print(`\n   Older than 90 days (3 months): ${over90}`);
  print(`   Older than 24 hours:           ${over1}`);

  // 2) Sign-up type
  line();
  print("2) By register_type");
  users.aggregate([
    { $match: pending },
    { $group: { _id: "$register_type", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).forEach((r) => print(`   ${pad(r._id || "(not set)", 40)} ${r.count}`));

  // 3) Reminder state (new fields)
  line();
  print("3) Reminder state");
  const notStarted = users.countDocuments({
    ...pending,
    $or: [{ verificationActivityAt: null }, { verificationActivityAt: { $exists: false } }],
  });
  print(`   Created before the reminder feature (no verificationActivityAt): ${notStarted}`);
  users.aggregate([
    { $match: pending },
    { $group: { _id: { $ifNull: ["$verificationReminderStage", 0] }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).forEach((r) => print(`   Reminder stage ${r._id}: ${r.count}`));

  // 4) Pending users that own data (these are never auto-deleted)
  line();
  print("4) Pending users that own data (never auto-deleted)");
  const firstMatch = (from, expr) => ({
    $lookup: {
      from,
      let: { id: "$_id" },
      pipeline: [{ $match: { $expr: expr } }, { $limit: 1 }],
      as: from,
    },
  });
  const linked = users.aggregate([
    { $match: pending },
    { $project: { email: 1 } },
    firstMatch("bookings", { $or: [{ $eq: ["$customer", "$$id"] }, { $eq: ["$provider", "$$id"] }] }),
    firstMatch("payments", { $or: [{ $eq: ["$user", "$$id"] }, { $eq: ["$provider", "$$id"] }] }),
    firstMatch("services", { $eq: ["$owner", "$$id"] }),
    firstMatch("servicerequests", { $eq: ["$owner", "$$id"] }),
    {
      $match: {
        $or: [
          { "bookings.0": { $exists: true } },
          { "payments.0": { $exists: true } },
          { "services.0": { $exists: true } },
          { "servicerequests.0": { $exists: true } },
        ],
      },
    },
  ]).toArray();
  print(`   ${linked.length} user(s)`);
  linked.slice(0, 20).forEach((u) => print(`   - ${u._id}  ${u.email}`));

  // 5 & 6) Oldest and newest
  const list = (title, sort) => {
    line();
    print(title);
    print(`   ${pad("created_at", 26)}${pad("days", 7)}${pad("type", 14)}email`);
    users.find(pending, { email: 1, created_at: 1, register_type: 1 })
      .sort({ created_at: sort })
      .limit(10)
      .forEach((u) => print(
        `   ${pad(u.created_at ? u.created_at.toISOString() : "-", 26)}` +
        `${pad(u.created_at ? daysAgo(u.created_at) : "-", 7)}` +
        `${pad(u.register_type || "-", 14)}${u.email}`,
      ));
  };
  list("5) 10 OLDEST pending sign-ups", 1);
  list("6) 10 NEWEST pending sign-ups", -1);

  // 7) What the reminder cron would do on its first run
  line();
  print("7) First cron run after deploy");
  print(`   Option A (current): reminder #1 emails in the first hour ~${over1}, deleted 0`);
  print(`   Option B: ${over90} get the final reminder now and are removed 30 days later`);
  line();
  print("Read-only report — nothing was changed.");
})();
