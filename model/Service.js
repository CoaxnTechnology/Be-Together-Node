const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  Language: { type: String, required: true },
  isFree: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  description: { type: String, default: null },

  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  tags: { type: [String], default: [] },

  max_participants: { type: Number, default: 1 },

  // Location
  location_name: { type: String, default: null },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },

  // Who created this service
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  // Type of service
  service_type: { type: String, enum: ["one_time", "recurring"], default: "one_time" },

  // one_time service
  date: { type: Date, default: null },
  start_time: { type: String, default: null },
  end_time: { type: String, default: null },

  // recurring service → inline schema for multiple slots
  recurring_schedule: {
    type: [
      {
        day: { type: String, required: true },        // e.g. "Monday"
        start_time: { type: String, required: true }, // "09:00"
        end_time: { type: String, required: true },   // "11:00"
        date: { type: Date, required: true }          // computed first date >= start_date
      }
    ],
    default: []
  },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

serviceSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model("Service", serviceSchema);
