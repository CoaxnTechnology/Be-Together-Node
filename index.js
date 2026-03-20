require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
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
const promotionSubscription = require("./routes/promotionSubscription.Routes");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const promotionController = require("./controller/promotionSubscription.controller");
const promotionPlanAdminRoutes = require("./routes/promotionPlanadminRoutes");
// --- KEEP RAW ONLY FOR GITHUB ---
app.post(
  "/webhook/github",
  express.raw({ type: "application/json" }),
  (req, res) => {
    console.log("🔥 BACKEND WEBHOOK HIT");

    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.log("❌ SECRET NOT SET");
      return res.status(500).send("no secret");
    }

    const signature = req.headers["x-hub-signature-256"];
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(req.body); // Buffer needed
    const digest = "sha256=" + hmac.digest("hex");

    if (signature !== digest) {
      return res.status(401).send("invalid");
    }
    //
    exec("bash /var/www/backend-uat/deploy.sh > /dev/null 2>&1 &");

    res.status(200).send("received");
  },
);
app.post(
  "/webhook/github-prod",
  express.raw({ type: "application/json" }),
  (req, res) => {
    console.log("🔥 PROD BACKEND WEBHOOK HIT-main");

    const secret = process.env.GITHUB_WEBHOOK_SECRET_PROD;
    if (!secret) return res.status(500).send("secret missing");

    const signature = req.headers["x-hub-signature-256"];
    const crypto = require("crypto");

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(req.body);
    const digest = "sha256=" + hmac.digest("hex");

    if (signature !== digest) {
      return res.status(401).send("invalid signature");
    }

    exec("bash /var/www/backend-prod/deploy-prod.sh > /dev/null 2>&1 &");

    res.status(200).send("prod deploy started");
  },
);
app.post("/webhook/frontend", (req, res) => {
  console.log("🔥 FRONTEND DEPLOY HIT");
  exec("bash /var/www/frontend-uat-admin/deploy.sh > /dev/null 2>&1 &");
  res.send("received");
});
app.post("/webhook/frontend-prod", (req, res) => {
  console.log("🔥 FRONTEND PROD DEPLOY HIT testing");

  exec("bash /var/www/frontend-prod-admin/deploy.sh > /dev/null 2>&1 &");

  res.status(200).send("received");
});
app.post(
  "/api/promotion/stripe/webhook",
  express.raw({ type: "application/json" }),
  promotionController.stripeWebhook,
);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  cors({
    origin: "*", // Allow all origins (not recommended for production)
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  }),
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
app.use("/api/promotion", promotionSubscription);
app.use("/api", promotionPlanAdminRoutes);
// Connect to MongoDB (live Atlas)
app.use("/api/admin", AdminRoutes);
console.log("Product ID:", process.env.STRIPE_PROMOTION_PRODUCT_ID);
console.log("apple client ID:", process.env.APPLE_CLIENT_ID);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
module.exports = app;
