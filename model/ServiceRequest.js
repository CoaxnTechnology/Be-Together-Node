const mongoose = require("mongoose");

// Shared shape for a location block with a full address (doorstep / pickup / drop)
const addressLocationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    city: { type: String, required: true },
    address: { type: String, required: true },
  },
  { _id: false },
);

// "atTheirPlace" only needs an area (lat/long + city), no exact address
const areaLocationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    city: { type: String, required: true },
  },
  { _id: false },
);

const serviceRequestSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true }, // e.g. "Looking for a tennis partner"
    description: { type: String, default: null },

    // ⭐ How the request is fulfilled — drives which location block(s) apply
    serviceType: {
      type: String,
      enum: ["doorstep", "pickDrop", "atTheirPlace"],
      required: true,
    },

    // Only set when serviceType === "doorstep"
    doorstepLocation: { type: addressLocationSchema, default: null },

    // Only set when serviceType === "pickDrop"
    pickupLocation: { type: addressLocationSchema, default: null },
    dropLocation: { type: addressLocationSchema, default: null },

    // Only set when serviceType === "atTheirPlace"
    atTheirPlaceLocation: { type: areaLocationSchema, default: null },

    numberOfParticipants: { type: Number, default: 1, min: 1 },

    // ⭐ Which of the 4 final booking flows this request uses (client-finalized
    // 24 Sep 2026): paid_fixed = fixed price, many seats ("Book Now");
    // paid_offer = providers submit a priced Offer, owner Accepts one or more
    // ("Submit Offer"); free_single = one Join wins ("Join"); free_group =
    // many Join until numberOfParticipants is reached ("Join").
    requestMode: {
      type: String,
      enum: ["paid_fixed", "paid_offer", "free_single", "free_group"],
      required: true,
    },

    // Atomic seat counter for paid_fixed / free_group (capped at
    // numberOfParticipants) and for paid_offer's "accept N offers" case.
    seatsBooked: { type: Number, default: 0, min: 0 },

    // Only set for free_single once someone Joins (first Join wins).
    joinedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    tags: { type: [String], default: [] },

    budget: {
      currency: { type: String, default: null },
      amount: { type: Number, default: null },
    },
    isFree: { type: Boolean, default: false },

    // The date/time this request is FOR — separate strings so the UI can
    // show them independently (matches Service's date/start_time/end_time
    // convention). `expiresAt` is auto-derived from date+endTime (or
    // startTime if no endTime) — see serviceRequestController.js.
    schedule: {
      date: { type: String, required: true }, // "DD/MM/YYYY"
      startTime: { type: String, required: true }, // "hh:mm AM/PM"
      endTime: { type: String, default: null }, // "hh:mm AM/PM"
    },

    // ⭐ Single canonical geo point used for all radius/nearby queries
    // (list page, home feed, notification matching) — derived from
    // whichever *Location block applies to this request's serviceType.
    location_name: { type: String, default: null },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    status: {
      type: String,
      enum: ["open", "fulfilled", "closed"],
      default: "open",
      index: true,
    },

    // Auto-derived from `schedule` (date + endTime/startTime) — kept as its
    // own field purely so list/feed queries can filter/index on it. Once
    // this passes, the request is excluded from list/feed queries but NOT
    // deleted from the DB — the record stays for history (e.g.
    // getMyServiceRequests still shows it).
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

serviceRequestSchema.index({ location: "2dsphere" });
serviceRequestSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("ServiceRequest", serviceRequestSchema);
