// models/Service.js
const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  Language:{type:String,required:true},
   isFree: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
  description: { type: String, default: null },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
   max_participants: { type: Number, default: 1 },
   
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

serviceSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model("Service", serviceSchema);
//open strret service