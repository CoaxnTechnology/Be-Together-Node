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
    const days = Number(req.query.days) || 7;
    const dateAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    console.log("🟢 Filter days:", days);
    console.log("🟢 Calculated dateAgo:", dateAgo);

    // Total users in last X days
    const totalUsers = await User.countDocuments({
      created_at: { $gte: dateAgo },
    });

    // Active/inactive based on last X days
    const inactiveUsers = await User.countDocuments({
      $or: [
        { "lastLocation.updatedAt": { $lt: dateAgo } },
        { "lastLocation.updatedAt": { $exists: false } },
        { "lastLocation.coords.coordinates": [0, 0] },
      ],
    });

    const activeUsers = totalUsers - inactiveUsers;

    // Fake users in last X days
    const totalFakeUsers = await User.countDocuments({
      is_fake: true,
      created_at: { $gte: dateAgo },
    });

    // Trend: compare with previous X days
    const prevDateAgo = new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000);
    const prevTotalUsers = await User.countDocuments({
      created_at: { $gte: prevDateAgo, $lt: dateAgo },
    });
    const userTrend = calculateTrend(totalUsers, prevTotalUsers);

    // SERVICES
    const totalServices = await Service.countDocuments({
      created_at: { $gte: dateAgo },
    });
    const prevTotalServices = await Service.countDocuments({
      created_at: { $gte: prevDateAgo, $lt: dateAgo },
    });
    const serviceTrend = calculateTrend(totalServices, prevTotalServices);

    // CATEGORIES
    const totalCategories = await Category.countDocuments({
      created_at: { $gte: dateAgo },
    });
    const prevTotalCategories = await Category.countDocuments({
      created_at: { $gte: prevDateAgo, $lt: dateAgo },
    });
    const categoryTrend = calculateTrend(totalCategories, prevTotalCategories);

    // TAGS
    const categories = await Category.find(
      { created_at: { $gte: dateAgo } },
      { tags: 1 }
    );
    const totalTags = categories.reduce(
      (sum, cat) => sum + (cat.tags?.length || 0),
      0
    );

    // REVIEWS
    const totalReviews = await Review.countDocuments({
      created_at: { $gte: dateAgo },
    });
    const positiveReviews = await Review.countDocuments({
      rating: { $gte: 4 },
      created_at: { $gte: dateAgo },
    });
    const neutralReviews = await Review.countDocuments({
      rating: 3,
      created_at: { $gte: dateAgo },
    });
    const negativeReviews = await Review.countDocuments({
      rating: { $lte: 2 },
      created_at: { $gte: dateAgo },
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
