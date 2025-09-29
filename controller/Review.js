const mongoose = require("mongoose");
const Review = require("../model/review");
const Service = require("../model/Service");
const User = require("../model/User");

// Create a review
exports.createReview = async (req, res) => {
  try {
    const { serviceId, userId, rating, text } = req.body;

    if (!serviceId || !userId || rating == null) {
      return res.status(400).json({ 
        isSuccess: false, 
        message: "serviceId, userId and rating are required" 
      });
    }

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ isSuccess: false, message: "Service not found" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ isSuccess: false, message: "User not found" });

    const review = new Review({
      service: service._id,
      user: user._id,
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

// Get reviews for a service

exports.getServiceReviews = async (req, res) => {
  try {
    // Accept serviceId from params or body
    const serviceId = req.params.serviceId || req.body.serviceId;

    if (!serviceId) {
      return res.status(400).json({
        isSuccess: false,
        message: "serviceId is required",
      });
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({
        isSuccess: false,
        message: "Invalid serviceId",
      });
    }

    // Fetch reviews and populate user info
    const reviews = await Review.find({ service: serviceId })
      .populate("user", "name profile_image") // gets the reviewer's name and profile
      .sort({ created_at: -1 });

    return res.json({
      isSuccess: true,
      data: reviews,
    });
  } catch (err) {
    console.error("getServiceReviews error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};

