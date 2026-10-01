// One-time migration: quotation changes used to live in their own
// "quotationchanges" collection; they now live on the booking
// (booking.quotationChanges). This copies every old record onto its booking
// and backfills the before/after price fields on Service Request bookings.
//
// Usage:
//   DRY RUN (no writes):  node scripts/migrateQuotationChanges.js --dry
//   Run:                  node scripts/migrateQuotationChanges.js
//
// Safe to run more than once — records already on the booking are skipped.
// The old collection is left untouched.
require("dotenv").config();
const mongoose = require("mongoose");
const Booking = require("../model/Booking");
const Payment = require("../model/Payment");

const DRY = process.argv.includes("--dry");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected${DRY ? " (DRY RUN — nothing will be written)" : ""}`);

  // 1) Move old quotation change records onto their bookings
  const oldChanges = await mongoose.connection
    .collection("quotationchanges")
    .find({})
    .sort({ createdAt: 1 })
    .toArray();
  let moved = 0;
  let skipped = 0;
  for (const old of oldChanges) {
    const booking = await Booking.findById(old.booking).select("quotationChanges");
    if (!booking) {
      console.log(`  ! booking ${old.booking} not found — skipping change ${old._id}`);
      skipped++;
      continue;
    }
    if (booking.quotationChanges.id(old._id)) {
      skipped++;
      continue;
    }
    const entry = {
      _id: old._id,
      provider: old.provider,
      previousAmount: old.previousAmount,
      proposedAmount: old.proposedAmount,
      reason: old.reason || "—",
      status: old.status,
      respondedAt: old.respondedAt || null,
      deltaAmount: old.deltaAmount || 0,
      customerPayable: old.customerPayable || 0,
      providerCommissionAmount: old.providerCommissionAmount || 0,
      customerCommissionAmount: old.customerCommissionAmount || 0,
      providerAmount: old.providerAmount || 0,
      currency: old.currency || null,
      checkoutSessionId: old.checkoutSessionId || null,
      paymentIntentId: old.paymentIntentId || null,
      paidAt: old.paidAt || null,
      refundedAmount: old.refundedAmount || 0,
      createdAt: old.createdAt,
      updatedAt: old.updatedAt,
    };
    console.log(`  → change ${old._id} (${old.status}) onto booking ${old.booking}`);
    if (!DRY) {
      await Booking.updateOne({ _id: old.booking }, { $push: { quotationChanges: entry } });
    }
    moved++;
  }

  // 2) Backfill the starting price on Service Request bookings/payments
  const bookings = await Booking.find({
    serviceRequest: { $ne: null },
    initialAmount: null,
  }).select("amount paymentId quotationChanges");
  let backfilled = 0;
  for (const booking of bookings) {
    const firstChange = [...booking.quotationChanges].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    )[0];
    const initialAmount = firstChange ? firstChange.previousAmount : booking.amount;
    if (!DRY) {
      await Booking.updateOne({ _id: booking._id }, { $set: { initialAmount } });
      if (booking.paymentId) {
        const payment = await Payment.findById(booking.paymentId).select("originalAmount");
        if (payment) {
          await Payment.updateOne(
            { _id: payment._id, initialServiceAmount: null },
            {
              $set: {
                initialServiceAmount: initialAmount,
                quotationAdjustmentAmount: Number(
                  ((payment.originalAmount || 0) - initialAmount).toFixed(2),
                ),
              },
            },
          );
        }
      }
    }
    backfilled++;
  }

  console.log(
    `Done. Quotation changes moved: ${moved}, skipped: ${skipped}. Bookings backfilled: ${backfilled}.`,
  );
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});
