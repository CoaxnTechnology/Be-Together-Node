const mongoose = require("mongoose");
const AutoIncrement = require("mongoose-sequence")(mongoose);

// Subdocument schema for Tags
const tagSchema = new mongoose.Schema({
  name: { type: String, required: true },
});

const categorySchema = new mongoose.Schema({
  categoryId: { type: Number, unique: true }, // numeric category id
  name: { type: String, required: true },
  image: { type: String, default: null },
  tags: [{ type: String }], // object array with only name
  order: {
    type: Number,
    required: true,
    index: true,
  },
  imagePublicId: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// Auto increment categoryId
categorySchema.plugin(AutoIncrement, { inc_field: "categoryId" });

// Remove tagId pre-save hook
categorySchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model("Category", categorySchema);
