const User = require("../model/User");
const Category = require("../model/Category");
const Service = require("../model/Service");
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
    const days = Number(req.query.days) || 7; // <-- dynamic filter
    const dateAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Total users
    const totalUsers = await User.countDocuments();

    // Users created in last X days
    const lastXDaysUsers = await User.countDocuments({
      created_at: { $gte: dateAgo },
    });

    // Inactive users (no location update in last X days)
    const inactiveUsers = await User.countDocuments({
      $or: [
        { "lastLocation.updatedAt": { $lt: dateAgo } },
        { "lastLocation.updatedAt": { $exists: false } },
        { "lastLocation.coords.coordinates": [0, 0] },
      ],
    });

    const activeUsers = totalUsers - inactiveUsers;
    const totalFakeUsers = await User.countDocuments({ is_fake: true });

    const userTrend = calculateTrend(totalUsers, totalUsers - lastXDaysUsers);

    // SERVICES
    const totalServices = await Service.countDocuments();
    const lastXDaysServices = await Service.countDocuments({
      created_at: { $gte: dateAgo },
    });

    const serviceTrend = calculateTrend(
      totalServices,
      totalServices - lastXDaysServices
    );

    // CATEGORIES
    const totalCategories = await Category.countDocuments();
    const lastXDaysCategories = await Category.countDocuments({
      created_at: { $gte: dateAgo },
    });

    const categoryTrend = calculateTrend(
      totalCategories,
      totalCategories - lastXDaysCategories
    );

    // TAGS count
    const categories = await Category.find({}, { tags: 1 });
    const totalTags = categories.reduce(
      (sum, cat) => sum + (cat.tags?.length || 0),
      0
    );

    // REVIEWS
    const totalReviews = await Review.countDocuments();
    const positiveReviews = await Review.countDocuments({
      rating: { $gte: 4 },
    });
    const neutralReviews = await Review.countDocuments({ rating: 3 });
    const negativeReviews = await Review.countDocuments({
      rating: { $lte: 2 },
    });

    const summaryWidgets = [
      {
        title: "Total Users",
        value: totalUsers.toString(),
        ...userTrend,
        icon: "users",
        color: "primary",
      },
      {
        title: "Total Fake Users",
        value: totalFakeUsers.toString(),
        icon: "users",
        color: "destructive",
      },
      {
        title: "Total Services",
        value: totalServices.toString(),
        ...serviceTrend,
        icon: "Briefcase",
        color: "success",
      },
      {
        title: "Total Categories",
        value: totalCategories.toString(),
        ...categoryTrend,
        icon: "Layers",
        color: "warning",
      },
      {
        title: "Total Tags",
        value: totalTags.toString(),
        icon: "Tags",
        color: "info",
      },
    ];

    const chartData = {
      users: [
        {
          name: "Active Users",
          value: activeUsers,
          color: "hsl(168 100% 50%)",
        },
        {
          name: "Inactive Users",
          value: inactiveUsers,
          color: "hsl(0 70% 55%)",
        },
      ],
      reviews: [
        { name: "Positive", value: positiveReviews, color: "hsl(142 70% 45%)" },
        { name: "Neutral", value: neutralReviews, color: "hsl(45 90% 55%)" },
        { name: "Negative", value: negativeReviews, color: "hsl(0 70% 55%)" },
      ],
    };

    res.status(200).json({ summaryWidgets, chartData });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
