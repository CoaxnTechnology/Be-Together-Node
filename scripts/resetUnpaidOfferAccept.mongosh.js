// ONE-TIME FIX — an offer that was "accepted" but never paid (Accept was
// pressed, Stripe page opened, no payment). Puts it back as it was before:
//   offer   → "pending"
//   request → the held seat is freed (seatsBooked − 1, "fulfilled" → "open")
//   payment → the unpaid checkout record is marked "canceled"
// Refuses to touch anything if the payment went through or a booking exists.
//
// Paste into MongoDB Compass → MONGOSH after `use <database_name>`.
// Run once with APPLY = false (preview), then set APPLY = true and paste again.
(() => {
  const APPLY = true; // ← preview first; change to true to apply

  const OFFER_ID = "6ac4bfc4d5f7083d4b73ec0a";
  const REQUEST_ID = "6ac4bde29d9ab244492e8489";
  const PAYMENT_ID = "6ac4eb08d5f7083d4b73f26f";

  const offers = db.getCollection("servicerequestoffers");
  const requests = db.getCollection("servicerequests");
  const payments = db.getCollection("payments");
  const bookings = db.getCollection("bookings");

  const offer = offers.findOne({ _id: ObjectId(OFFER_ID) });
  const request = requests.findOne({ _id: ObjectId(REQUEST_ID) });
  const payment = payments.findOne({ _id: ObjectId(PAYMENT_ID) });

  print(`\nDB: ${db.getName()}`);
  print(`Offer   ${OFFER_ID}: ${offer ? `status=${offer.status}, request=${offer.request}` : "NOT FOUND"}`);
  print(`Request ${REQUEST_ID}: ${request ? `status=${request.status}, seatsBooked=${request.seatsBooked}/${request.numberOfParticipants}` : "NOT FOUND"}`);
  print(`Payment ${PAYMENT_ID}: ${payment ? `status=${payment.status}, bookingId=${payment.bookingId || "none"}` : "NOT FOUND"}`);

  // ---- safety checks ----
  const problems = [];
  if (!offer) problems.push("offer not found");
  if (!request) problems.push("request not found");
  if (offer && String(offer.request) !== REQUEST_ID) problems.push("offer belongs to a different request");
  if (offer && !["accepted", "payment_pending"].includes(offer.status)) {
    problems.push(`offer status is "${offer.status}" — nothing to reset`);
  }
  if (payment && (payment.status === "held" || payment.status === "completed" || payment.bookingId)) {
    problems.push(`payment is "${payment.status}" — the customer DID pay, do not reset`);
  }
  const activeBooking = offer
    ? bookings.findOne({
        serviceRequest: ObjectId(REQUEST_ID),
        provider: offer.provider,
        status: { $in: ["booked", "started", "completed"] },
      })
    : null;
  if (activeBooking) problems.push(`a booking exists (${activeBooking._id}) — do not reset`);

  if (problems.length) {
    print("\nNOT SAFE — nothing changed:");
    problems.forEach((p) => print(`   - ${p}`));
    return;
  }

  const notExpired = !request.expiresAt || request.expiresAt > new Date();
  const newSeats = Math.max(0, (request.seatsBooked || 0) - 1);
  const reopen = request.status === "fulfilled" && notExpired && newSeats < request.numberOfParticipants;

  print("\nWill do:");
  print(`   offer   → status "pending"`);
  print(`   request → seatsBooked ${request.seatsBooked} → ${newSeats}${reopen ? ', status "fulfilled" → "open"' : ""}`);
  print(payment ? `   payment → status "${payment.status}" → "canceled"` : "   payment → not found, skipped");

  if (!APPLY) {
    print("\nPREVIEW ONLY — nothing changed. Set APPLY = true and paste again.");
    return;
  }

  offers.updateOne(
    { _id: offer._id, status: { $in: ["accepted", "payment_pending"] } },
    { $set: { status: "pending", updatedAt: new Date() } },
  );
  requests.updateOne(
    { _id: request._id },
    { $set: { seatsBooked: newSeats, ...(reopen ? { status: "open" } : {}), updatedAt: new Date() } },
  );
  if (payment && payment.status === "pending") {
    payments.updateOne(
      { _id: payment._id, status: "pending" },
      {
        $set: {
          status: "canceled",
          failureReason: "Accept reset manually — checkout was never paid",
          updatedAt: new Date(),
        },
      },
    );
  }

  const after = {
    offer: offers.findOne({ _id: offer._id }).status,
    request: requests.findOne({ _id: request._id }, { status: 1, seatsBooked: 1 }),
    payment: payment ? payments.findOne({ _id: payment._id }).status : "—",
  };
  print(`\nDone → offer: ${after.offer} | request: ${after.request.status}, seatsBooked ${after.request.seatsBooked} | payment: ${after.payment}`);
})();
