// const mongoose = require("mongoose");

// const apiLogSchema = new mongoose.Schema(
//   {
//     method: {
//       type: String,
//       required: true,
//     },

//     endpoint: {
//       type: String,
//       required: true,
//     },

//     statusCode: {
//       type: Number,
//       required: true,
//     },

//     success: {
//       type: Boolean,
//       required: true,
//     },

//     message: {
//       type: String,
//       default: null,
//     },

//     error: {
//       type: String,
//       default: null,
//     },

//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       default: null,
//     },

//     adminId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Admin",
//       default: null,
//     },

//     ip: {
//       type: String,
//       default: null,
//     },

//     duration: {
//       type: Number,
//       default: 0, // milliseconds
//     },

//     createdAt: {
//       type: Date,
//       default: Date.now,
//       expires: 60 * 60 * 24 * 30, // Auto delete after 30 days
//     },
//   },
//   {
//     versionKey: false,
//   },
// );

// module.exports = mongoose.model("ApiLog", apiLogSchema);
