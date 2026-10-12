// ONE-TIME FIX — offers still stored as "accepted" although their paid
// booking was cancelled (cancelled before the "cancelled" offer status
// existed). Sets them to "cancelled", the same as a cancellation does now:
//   • the offer drops out of the customer's offer list
//   • the provider can send a new offer on the request
// Skips an offer if the provider still has an active booking on that request.
//
// Paste into MongoDB Compass → MONGOSH after `use <database_name>`.
// Run once with APPLY = false (preview), then set APPLY = true and paste again.
(() => {
  const APPLY = true; // ← preview first; change to true to apply

  const offers = db.getCollection("servicerequestoffers");
  const bookings = db.getCollection("bookings");
  const payments = db.getCollection("payments");

  const toFix = [];
  offers.find({ status: "accepted" }).forEach((offer) => {
    // The offer's own booking via its payment; else the provider's on the request.
    // (mongosh findOne's 2nd argument is a projection, so the newest is
    // picked with find().sort().limit(1).)
    const newest = (coll, filter) => coll.find(filter).sort({ createdAt: -1 }).limit(1).toArray()[0] || null;
    const payment = newest(payments, { serviceRequestOffer: offer._id, bookingId: { $ne: null } });
    const booking =
      (payment && bookings.findOne({ _id: payment.bookingId })) ||
      newest(bookings, { serviceRequest: offer.request, provider: offer.provider });
    if (!booking || booking.status !== "cancelled") return;

    const active = bookings.findOne({
      serviceRequest: offer.request,
      provider: offer.provider,
      status: { $in: ["booked", "started", "completed"] },
    });
    if (active) return;

    toFix.push({ offer, booking });
  });

  print(`\nDB: ${db.getName()}`);
  print(`Accepted offers checked: ${offers.countDocuments({ status: "accepted" })}`);
  print(`Accepted offers whose booking was cancelled: ${toFix.length}`);
  toFix.forEach(({ offer, booking }) =>
    print(`   offer ${offer._id}  request ${offer.request}  booking ${booking._id} (cancelled)`),
  );

  if (!toFix.length) return;
  if (!APPLY) {
    print("\nPREVIEW ONLY — nothing changed. Set APPLY = true and paste again.");
    return;
  }

  const res = offers.updateMany(
    { _id: { $in: toFix.map((x) => x.offer._id) }, status: "accepted" },
    { $set: { status: "cancelled", updatedAt: new Date() } },
  );
  print(`\nDone → ${res.modifiedCount} offer(s) set to "cancelled".`);
})();
