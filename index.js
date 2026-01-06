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
const notificationRoutes = require("./routes/notificationRoutes");
const AdminRoutes = require("./routes/AdminRoutes");
const statsRoutes = require("./routes/statsRoutes");
const commissionRoutes = require("./routes/adminCommissionRoutes");
const cancellationRoutes = require("./routes/adminCancellationRoutes");
const stripeRoutes = require("./routes/stripeConnectRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const paymentViolationRoutes = require("./routes/paymentViolationRoutes");
const connectDB = require("./utils/connect");
const app = express();
const crypto = require("crypto");
const { exec } = require("child_process");

app.post(
  "/webhook/github",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      console.log("✅ Webhook hit");

      const signature = req.headers["x-hub-signature-256"];
      if (!signature) {
        console.log("❌ No signature");
        return res.status(401).send("No signature");
      }

      const secret = process.env.GITHUB_WEBHOOK_SECRET;

      const hmac = crypto.createHmac("sha256", secret);
      hmac.update(req.body); // MUST be Buffer
      const digest = "sha256=" + hmac.digest("hex");

      if (signature !== digest) {
        console.log("❌ Invalid signature");
        return res.status(401).send("Invalid signature");
      }

      console.log("🚀 Signature verified, deploying...");

      exec("bash /var/www/testing/api/deploy.sh");

      return res.status(200).send("Deployment started");
    } catch (err) {
      console.error("❌ Webhook crash:", err);
      return res.status(500).send("Webhook errorr");
    }
  }
);
app.post("/webhook/github", (req, res) => {
  console.log("🔥 FRONTEND WEBHOOK HIT");

  exec("bash /var/www/testing/admin/deploy.sh > /dev/null 2>&1 &");

  res.status(200).json({ message: "received" });
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  cors({
    origin: "*", // Allow all origins (not recommended for production)
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);
connectDB();

// Route to serve terms_and_conditions.html
app.get("/api/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "terms_and_conditions.html"));
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api", profileRoutes);
//app.use("/api/admin/categories", categoryRoutes);
app.use("/api/service", serviceRoutes);
app.use("/api/onbording", userTags);
app.use("/api/user", locationRoutes);
app.use("/api", ReviewRoutes);
app.use("/api/admin/profile", require("./routes/adminProfileroutes"));
//app.use("/api/notifications", notificationRoutes);
//----------------------Admin API ROutes

app.use("/api/stats", statsRoutes);
//payment routes
// app.use((req, res, next) => {
//   if (req.originalUrl === "/api/stripe/webhook") {
//     next();
//   } else {
//     express.json()(req, res, next);
//   }
// });

app.use("/api/admin/commission", commissionRoutes);
app.use("/api/admin/cancellation", cancellationRoutes);

app.use("/api/stripe/connect", stripeRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/payment/violation", paymentViolationRoutes);

// Connect to MongoDB (live Atlas)
app.use("/api/admin", AdminRoutes);
// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} `));
module.exports = app;
//new changes
