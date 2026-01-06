// seedAdmin.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Admin = require("./model/Admin");
require("dotenv").config();
const DB_URI = process.env.MONGO_URI; // replace with your DB URI

mongoose.connect(DB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("Connected to MongoDB");

    const existingAdmin = await Admin.findOne({ email: "hammadsunsara2620@gmail.com" });
    if (existingAdmin) {
      console.log("Admin already exists");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash("admin@1212", 10);

    const admin = new Admin({
      name: "Betogether",
      email: "hammadsunsara2620@gmail.com",
      hashed_password: hashedPassword,
      is_active: true,
    });
    await admin.save();
    console.log("Admin created successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1);
  });
