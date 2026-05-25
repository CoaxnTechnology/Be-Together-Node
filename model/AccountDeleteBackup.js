const mongoose = require("mongoose");
const serviceSnapshotSchema = new mongoose.Schema(
  {
    serviceId: mongoose.Schema.Types.ObjectId,

    title: String,

    Language: String,

    isFree: Boolean,

    price: Number,

    description: String,

    currency: String,

    category: {
      _id: mongoose.Schema.Types.ObjectId,

      name: String,
    },

    tags: [String],

    max_participants: Number,

    location_name: String,

    location: {
      type: {
        type: String,
      },

      coordinates: [Number],
    },

    image: String,

    imagePublicId: String,

    city: String,

    isDoorstepService: Boolean,

    owner: {
      _id: mongoose.Schema.Types.ObjectId,

      name: String,

      email: String,

      mobile: String,
    },

    service_type: String,

    // delete flow
    isDeleteRequested: Boolean,

    deleteApprovedByAdmin: Boolean,

    deleteRequestReason: String,

    deleteRequestStatus: String,

    deleteRequestedAt: Date,

    // one time
    date: String,

    start_time: String,

    end_time: String,

    recurring_schedule: [
      {
        day: String,

        start_time: String,

        end_time: String,

        date: String,
      },
    ],

    // promotion
    isPromoted: Boolean,

    promotionType: String,

    promotionPlanDays: Number,

    promotionStart: Date,

    promotionEnd: Date,

    promotionAmount: Number,

    promotionPaymentId: String,

    promotionSubscriptionId: String,

    promotionPriceId: String,

    promotionAutoRenew: Boolean,

    promotionStatus: String,

    promotionCancelledAt: Date,

    created_at: Date,

    updated_at: Date,
  },
  {
    _id: false,
  },
);
