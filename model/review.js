const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  // ⭐ Relaxed to optional — a review on a Service-Request-sourced booking
  // (see `booking`/`provider` below) has no `Service` doc at all. Existing
  // Service-scoped reviews keep setting this exactly as before.
  service: { type: mongoose.Schema.Types.ObjectId, ref: "Service", default: null },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  // ⭐ The booking this review is for — required (enforced in the
  // controller, not here, so it stays additive/non-breaking for any rows
  // written before this field existed). One review per booking.
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
  // ⭐ The provider being rated — derived from `booking.provider` at
  // creation time, so this works identically for both Service- and
  // Service-Request-sourced bookings (unlike `service.owner`, which only
  // exists for the former).
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rating: { type: Number, required: true, min: 0, max: 5 },
  text: { type: String, default: "" },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Review", reviewSchema);
