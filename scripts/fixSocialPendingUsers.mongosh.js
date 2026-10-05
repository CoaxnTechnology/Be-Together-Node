// ONE-TIME DATA FIX — Google / Apple users wrongly saved as "pending_verification".
//
// The Google/Apple *login* endpoint used to create new users without a
// status, so they got the schema default "pending_verification" even though
// the provider had already verified their email. They use the app normally,
// but the new unfinished-registration cron must never email or delete them.
//
// Changes: sets status "active" on those users only (register_type
// google_auth / apple_auth). Email (manual) sign-ups are not touched.
//
// Paste into MongoDB Compass → MONGOSH after `use <database_name>`.
// Set APPLY = false first to only preview.
(() => {
  const APPLY = false; // ← preview first; change to true to apply the fix

  const filter = {
    status: "pending_verification",
    register_type: { $in: ["google_auth", "apple_auth"] },
  };
  const users = db.getCollection("users");

  const found = users
    .find(filter, { email: 1, register_type: 1, created_at: 1 })
    .sort({ created_at: 1 })
    .toArray();
  print(`\n${found.length} Google/Apple user(s) wrongly in pending_verification (db: ${db.getName()}):`);
  found.forEach((u) =>
    print(`   ${u._id}  ${String(u.register_type).padEnd(12)} ${u.email}`),
  );

  if (!APPLY) {
    print("\nPREVIEW ONLY — nothing changed. Set APPLY = true and paste again to fix.");
    return;
  }

  const result = users.updateMany(filter, {
    $set: { status: "active", otp_verified: true, updated_at: new Date() },
  });
  print(`\nFixed: ${result.modifiedCount} user(s) set to "active".`);
  print(`Still pending (email sign-ups only): ${users.countDocuments({ status: "pending_verification" })}`);
})();
