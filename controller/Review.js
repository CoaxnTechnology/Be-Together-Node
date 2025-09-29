const Review = require("../model/review");
const Service = require("../model/Service");
const User = require("../model/User");

exports.createReview = async (req, res) => {
  try {
    const { serviceId, userId, rating, text } = req.body;

    // Validate input
    if (!serviceId || !userId || rating == null) {
      return res.status(400).json({ isSuccess: false, message: "serviceId, userId and rating are required" });
    }

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ isSuccess: false, message: "Service not found" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ isSuccess: false, message: "User not found" });

    // Create review
    const review = new Review({
      service: service._id,
      user: user._id,
      rating: Number(rating),
      text: text || "",
    });

    await review.save();

    return res.json({ isSuccess: true, message: "Review submitted successfully", data: review });
  } catch (err) {
    console.error("createReview error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};
exports.getServiceReviews = async (req, res) => {
  try {
    const { serviceId } = req.query;
    if (!serviceId) return res.status(400).json({ isSuccess: false, message: "serviceId is required" });

    const reviews = await Review.find({ service: serviceId })
      .populate({ path: "user", select: "name avatar" })
      .sort({ created_at: -1 })
      .lean();

    // Calculate average rating
    const avgRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

    return res.json({ isSuccess: true, data: { reviews, avgRating } });
  } catch (err) {
    console.error("getServiceReviews error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error", error: err.message });
  }
};
