const mongoose = require("mongoose");

const pendingUserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  otp: { type: Number, required: true },
  expiry: { type: Date, required: true },
  userData: {
    uid: { type: Number, default: null },
    name: { type: String },
    email: { type: String },
    mobile: { type: String },
    hashed_password: { type: String },
    register_type: { type: String },
    otp_verified: { type: Boolean, default: false },
    profile_image: { type: String, default: null },
  },
});

// TTL index → auto delete expired docs
pendingUserSchema.index({ expiry: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PendingUser", pendingUserSchema);
