const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const userTags = require("./routes/userTags");
const locationRoutes = require("./routes/location");
const ReviewRoutes = require("./routes/ReviewRoutes");
const notificationRoutes= require("./routes/notificationRoutes")
const AdminRoutes = require("./routes/AdminRoutes");
const statsRoutes = require("./routes/statsRoutes");
const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (mobile apps, Postman, curl)
      if (!origin) return callback(null, true);

      // allow requests from your admin frontend
      if (origin === "https://betogether-admin.vercel.app") return callback(null, true);

      // block all other unknown origins
      return callback(new Error("CORS policy does not allow this origin"), false);
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true, // keep true if using cookies or auth headers
  })
);

// Route to serve terms_and_conditions.html
app.get("/api/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "terms_and_conditions.html"));
});
const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB Connected");

// API routes
app.use("/api/auth", authRoutes);
app.use("/api", profileRoutes);
//app.use("/api/admin/categories", categoryRoutes);
app.use("/api/service", serviceRoutes);
app.use("/api/onbording", userTags);
 app.use("/api/user", locationRoutes);
app.use("/api",ReviewRoutes)
//app.use("/api/notifications", notificationRoutes);
//----------------------Admin API ROutes
app.use("/api/admin", AdminRoutes);

app.use("/api/stats", statsRoutes);
 const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1); // Stop server if DB fails
  }
};

startServer();
module.exports = app;