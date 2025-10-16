const User = require("../model/User");
const Category = require("../model/Category");
const Service = require("../model/Service");
//const Booking = require("../model/Booking");
const Review = require("../model/review");

// Helper to calculate trend
const calculateTrend = (current, previous) => {
  const diff = current - previous;
  const percent = previous === 0 ? 100 : (diff / previous) * 100;
  return {
    trend: diff >= 0 ? "up" : "down",
    change: `${diff >= 0 ? "+" : ""}${percent.toFixed(1)}%`,
  };
};

exports.getStats = async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Total users
    const totalUsers = await User.countDocuments();

    // Users created last month
    const lastMonthUsers = await User.countDocuments({
      created_at: { $gte: new Date(now.setMonth(now.getMonth() - 1)) },
    });

    // Inactive users (no location update in last 7 days)
    const inactiveUsers = await User.countDocuments({
      "lastLocation.recordedAt": { $lte: sevenDaysAgo },
    });

    // Active users = total - inactive
    const activeUsers = totalUsers - inactiveUsers;
     const totalFakeUsers = await User.countDocuments({ is_fake: true });

    // Trend for users (based on total)
    const userTrend = calculateTrend(totalUsers, totalUsers - lastMonthUsers);

    // SERVICES
    const totalServices = await Service.countDocuments();
    const lastMonthServices = await Service.countDocuments({
      created_at: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) },
    });
    const serviceTrend = calculateTrend(totalServices, totalServices - lastMonthServices);

    // CATEGORIES
    const totalCategories = await Category.countDocuments();
    const lastMonthCategories = await Category.countDocuments({
      created_at: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)) },
    });
    const categoryTrend = calculateTrend(totalCategories, totalCategories - lastMonthCategories);

    // BOOKINGS
    // const completedBookings = await Booking.countDocuments({ status: "completed" });
    // const pendingBookings = await Booking.countDocuments({ status: "pending" });
    // const cancelledBookings = await Booking.countDocuments({ status: "cancelled" });

    // REVIEWS
    // const positiveReviews = await Review.countDocuments({ rating: { $gte: 4 } });
    // const neutralReviews = await Review.countDocuments({ rating: 3 });
    // const negativeReviews = await Review.countDocuments({ rating: { $lte: 2 } });

    const summaryWidgets = [
      { title: "Total Users", value: totalUsers.toString(), ...userTrend, icon: "users", color: "primary" },
      { title: "Active Users", value: activeUsers.toString(), icon: "users", color: "success" },
      { title: "Inactive Users", value: inactiveUsers.toString(), icon: "users", color: "warning" },
       { title: "Total Fake Users", value: totalFakeUsers.toString(), icon: "users", color: "destructive" },
      { title: "Total Services", value: totalServices.toString(), ...serviceTrend, icon: "Briefcase", color: "success" },
      { title: "Total Categories", value: totalCategories.toString(), ...categoryTrend, icon: "Layers", color: "warning" },
    //  { title: "Bookings This Month", value: completedBookings.toString(), icon: "calendar", color: "primary" },
    ];

    const chartData = {
      users: [
        { name: "Active Users", value: activeUsers, color: "hsl(168 100% 50%)" },
        { name: "Inactive Users", value: inactiveUsers, color: "hsl(0 70% 55%)" },
      ],
      services: [
        { name: "Total Services", value: totalServices, color: "hsl(142 70% 45%)" },
      ],
    //   bookings: [
    //     { name: "Completed", value: completedBookings, color: "hsl(168 100% 50%)" },
    //     { name: "Pending", value: pendingBookings, color: "hsl(210 100% 56%)" },
    //     { name: "Cancelled", value: cancelledBookings, color: "hsl(0 70% 55%)" },
    //   ],
    //   reviews: [
    //     { name: "Positive", value: positiveReviews, color: "hsl(142 70% 45%)" },
    //     { name: "Neutral", value: neutralReviews, color: "hsl(45 90% 55%)" },
    //     { name: "Negative", value: negativeReviews, color: "hsl(0 70% 55%)" },
    //   ],
    };

    res.status(200).json({ summaryWidgets, chartData });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
