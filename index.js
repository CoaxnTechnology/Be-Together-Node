// const express = require("express");
// const path = require("path");
// const mongoose = require("mongoose");
// require("dotenv").config();
// const cors = require("cors");
// const authRoutes = require("./routes/authRoutes");
// const profileRoutes = require("./routes/profileRoutes");
// const categoryRoutes = require("./routes/categoryRoutes");
// const serviceRoutes = require("./routes/serviceRoutes");
// const userTags = require("./routes/userTags");
// const locationRoutes = require("./routes/location");
// const ReviewRoutes = require("./routes/ReviewRoutes");
// const notificationRoutes = require("./routes/notificationRoutes");
// const AdminRoutes = require("./routes/AdminRoutes");
// const statsRoutes = require("./routes/statsRoutes");
// const connectDB = require("./utils/connect");
// const app = express();

// // Middleware
// app.use(express.urlencoded({ extended: true }));
// app.use(express.json());

// app.use(
//   cors({
//     origin: "*", // Allow all origins (not recommended for production)
//     methods: ["GET", "POST", "PUT", "DELETE"],
//     credentials: true,
//   })
// );
// connectDB();

// // Route to serve terms_and_conditions.html
// app.get("/api/terms", (req, res) => {
//   res.sendFile(path.join(__dirname, "templates", "terms_and_conditions.html"));
// });

// // API routes
// app.use("/api/auth", authRoutes);
// app.use("/api", profileRoutes);
// //app.use("/api/admin/categories", categoryRoutes);
// app.use("/api/service", serviceRoutes);
// app.use("/api/onbording", userTags);
// app.use("/api/user", locationRoutes);
// app.use("/api", ReviewRoutes);
// //app.use("/api/notifications", notificationRoutes);
// //----------------------Admin API ROutes

// app.use("/api/stats", statsRoutes);
// //payment routes
// // app.use((req, res, next) => {
// //   if (req.originalUrl === "/api/stripe/webhook") {
// //     next();
// //   } else {
// //     express.json()(req, res, next);
// //   }
// // });

//  app.use("/api/admin/commission", require("./routes/adminCommissionRoutes"));
// // app.use("/api/admin/cancellation", require("./routes/adminCancellationRoutes"));

// // app.use("/api/stripe/connect", require("./routes/stripeConnectRoutes"));
// // app.use("/api/payments", require("./routes/paymentRoutes"));
// // app.use("/api/payment/violation", require("./routes/paymentViolationRoutes"));

// // Connect to MongoDB (live Atlas)
// app.use("/api/admin", AdminRoutes);
// // Start server
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// module.exports = app;
// //new changes