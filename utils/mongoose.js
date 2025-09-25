// lib/mongoose.js
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URL;
if (!MONGO_URI) {
  console.warn("lib/mongoose: MONGODB_URI not set in environment");
}

let cached = global.__mongoose_cache || (global.__mongoose_cache = { conn: null, promise: null });

async function connect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI, {
      // recommended serverless options
      bufferCommands: false,
      // other options can be added if needed
    }).then(m => {
      return m;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connect;
