const mongoose = require("mongoose");

// =====================================
// USER SNAPSHOT
// =====================================
const userSnapshotSchema = new mongoose.Schema(
  {
    uid: String,
    name: String,
    email: String,
    mobile: String,
    profile_image: String,
    bio: String,
    city: String,
    age: Number,
    country: String,

    register_type: String,
    login_type: String,

    status: String,
    is_active: Boolean,
    is_google_auth: Boolean,

    languages: [String],
    interests: [String],
    offeredTags: [String],

    currency: String,
    provider_uid: String,

    referralCode: String,
    totalReferralUsers: Number,
    totalReferralEarned: Number,

    performancePoints: Number,
    totalBookings: Number,
    successfulBookings: Number,

    stripeCustomerId: String,
    stripeAccountId: String,

    created_at: Date,
    updated_at: Date,
    last_login: Date,
  },
  {
    _id: false,
  },
);

// =====================================
// SERVICE SNAPSHOT
// =====================================
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

// =====================================
// BOOKING SNAPSHOT
// =====================================
const bookingSnapshotSchema = new mongoose.Schema(
  {
    bookingId: mongoose.Schema.Types.ObjectId,

    contactPhone: String,
    location_name: String,

    location: {
      type: {
        type: String,
      },
      coordinates: [Number],
    },

    amount: Number,
    status: String,

    otp: Number,
    otpExpiry: Date,

    cancelledBy: String,
    cancelReason: String,

    cancellationFee: Number,
    refundAmount: Number,

    createdAt: Date,
    updatedAt: Date,

    customer: {
      _id: mongoose.Schema.Types.ObjectId,
      name: String,
      email: String,
      mobile: String,
    },

    provider: {
      _id: mongoose.Schema.Types.ObjectId,
      name: String,
      email: String,
      mobile: String,
    },

    service: {
      _id: mongoose.Schema.Types.ObjectId,
      title: String,
      price: Number,
      currency: String,
    },
  },
  {
    _id: false,
  },
);

// =====================================
// PAYMENT SNAPSHOT
// =====================================
const paymentSnapshotSchema = new mongoose.Schema(
  {
    paymentId: mongoose.Schema.Types.ObjectId,

    bookingId: String,
    checkoutSessionId: String,

    paymentIntentId: String,

    customerStripeId: String,
    providerStripeId: String,

    amount: Number,

    appCommission: Number,
    providerAmount: Number,

    currency: String,
    status: String,

    refundId: String,
    refundReason: String,

    contactPhone: String,
    location_name: String,

    location: {
      type: {
        type: String,
      },
      coordinates: [Number],
    },

    completedAt: Date,
    refundedAt: Date,

    createdAt: Date,
    updatedAt: Date,

    user: {
      _id: mongoose.Schema.Types.ObjectId,
      name: String,
      email: String,
      mobile: String,
    },

    provider: {
      _id: mongoose.Schema.Types.ObjectId,
      name: String,
      email: String,
      mobile: String,
    },

    service: {
      _id: mongoose.Schema.Types.ObjectId,
      title: String,
      price: Number,
      currency: String,
    },
  },
  {
    _id: false,
  },
);

// =====================================
// MAIN BACKUP SCHEMA
// =====================================
const accountDeleteBackupSchema = new mongoose.Schema(
  {
    deletedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    userDetails: userSnapshotSchema,

    services: [serviceSnapshotSchema],

    bookings: [bookingSnapshotSchema],

    payments: [paymentSnapshotSchema],

    summary: {
      totalServices: {
        type: Number,
        default: 0,
      },

      totalBookings: {
        type: Number,
        default: 0,
      },

      totalPayments: {
        type: Number,
        default: 0,
      },
    },

    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "AccountDeleteBackup",
  accountDeleteBackupSchema,
);
