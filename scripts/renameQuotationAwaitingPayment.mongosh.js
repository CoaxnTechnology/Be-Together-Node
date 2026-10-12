// ONE-TIME FIX — the price-change (quotation) status "awaiting_payment" was
// renamed to "payment_pending". Renames it on price changes already saved,
// so the new code (and the 10-minute payment recovery cron) still finds them.
// Run it right after the new backend is deployed, on each database (UAT, prod).
//
// Paste into MongoDB Compass → MONGOSH after `use <database_name>`.
// Run once with APPLY = false (preview), then set APPLY = true and paste again.
(() => {
  const APPLY = false; // ← preview first; change to true to apply

  const bookings = db.getCollection("bookings");
  const filter = { "quotationChanges.status": "awaiting_payment" };

  print(`\nDB: ${db.getName()}`);
  const found = bookings.find(filter, { quotationChanges: 1 }).toArray();
  const count = found.reduce(
    (n, b) => n + b.quotationChanges.filter((q) => q.status === "awaiting_payment").length,
    0,
  );
  print(`Bookings with an "awaiting_payment" price change: ${found.length} (${count} price change(s))`);
  found.forEach((b) => print(`   booking ${b._id}`));

  if (!found.length) return;
  if (!APPLY) {
    print("\nPREVIEW ONLY — nothing changed. Set APPLY = true and paste again.");
    return;
  }

  const res = bookings.updateMany(
    filter,
    { $set: { "quotationChanges.$[q].status": "payment_pending" } },
    { arrayFilters: [{ "q.status": "awaiting_payment" }] },
  );
  print(`\nDone → ${res.modifiedCount} booking(s) updated.`);
  print(`Left with "awaiting_payment": ${bookings.countDocuments(filter)}`);
})();
