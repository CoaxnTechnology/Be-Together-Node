const Review = require("../model/review");
const Service = require("../model/Service");
const User = require("../model/User");

exports.createReview = async (req, res) => {
  try {
    const { serviceId, userId, rating, text } = req.body;

    // Validate input
    if (!serviceId || !userId || rating == null) {
      return res.status(400).json({ 
        isSuccess: false, 
        message: "serviceId, userId and rating are required" 
      });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({ isSuccess: false, message: "Service not found" });
    }

    const user = await User.findById(userId).select("name email");
    if (!user) {
      return res.status(404).json({ isSuccess: false, message: "User not found" });
    }

    // Create review with username automatically
    const review = new Review({
      service: service._id,
      user: user._id,
      username: user.name,   // ✅ Extracted username
      rating: Number(rating),
      text: text || "",
    });

    await review.save();

    return res.json({ 
      isSuccess: true, 
      message: "Review submitted successfully", 
      data: review 
    });
  } catch (err) {
    console.error("createReview error:", err);
    return res.status(500).json({ 
      isSuccess: false, 
      message: "Server error", 
      error: err.message 
    });
  }
};
//getServiceReviews
exports.getServiceReviews = async (req, res) => {
  try {
    const { serviceId } = req.params;

    const reviews = await Review.find({ service: new mongoose.Types.ObjectId(serviceId), })
      .populate("user", "name email"); // ✅ yaha se username mil jayega

    return res.json({
      isSuccess: true,
      data: reviews
    });
  } catch (err) {
    console.error("getReviewsByService error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message
    });
  }
};

