const mongoose = require("mongoose");
const Review = require("../model/review");
const Service = require("../model/Service");
const User = require("../model/User");
const Booking = require("../model/Booking");

// Create a review — now gated on a real, completed booking (previously
// anyone could review any service at any time, any number of times).
// Works for both Service- and Service-Request-sourced bookings, since the
// provider is derived from `booking.provider`, not `service.owner`.
exports.createReview = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ isSuccess: false, message: "Unauthorized" });
    }
    const { bookingId, rating, text } = req.body;

    if (!bookingId || rating == null) {
      return res.status(400).json({
        isSuccess: false,
        message: "bookingId and rating are required",
      });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ isSuccess: false, message: "Booking not found" });
    }
    if (String(booking.customer) !== String(userId)) {
      return res.status(403).json({
        isSuccess: false,
        message: "You can only review your own booking",
      });
    }
    if (booking.status !== "completed") {
      return res.status(400).json({
        isSuccess: false,
        message: "You can only review a booking once the service is completed",
      });
    }

    const existing = await Review.findOne({ booking: booking._id });
    if (existing) {
      return res.status(400).json({
        isSuccess: false,
        message: "You have already reviewed this booking",
      });
    }

    const review = new Review({
      service: booking.service || null,
      booking: booking._id,
      provider: booking.provider,
      user: userId,
      rating: Number(rating),
      text: text || "",
    });

    await review.save();

    return res.status(201).json({
      isSuccess: true,
      message: "Review submitted successfully",
      data: review,
    });
  } catch (err) {
    console.error("createReview error:", err);
    return res.status(500).json({
      isSuccess: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// Small reusable helper — average rating + count for a provider, same
// calc style as getServiceReviews below. Used by serviceRequestController.js
// to rank Offers / nearby requests by the provider's rating.
exports.getProviderRating = async (providerId) => {
  const reviews = await Review.find({ provider: providerId }).select("rating");
  if (!reviews.length) return { averageRating: 0, totalReviews: 0 };
  const total = reviews.reduce((sum, r) => sum + r.rating, 0);
  return {
    averageRating: Number((total / reviews.length).toFixed(1)),
    totalReviews: reviews.length,
  };
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

    // Calculate average rating
    let avgRating = 0;
    if (reviews.length > 0) {
      const total = reviews.reduce((sum, r) => sum + r.rating, 0);
      avgRating = total / reviews.length;
      avgRating = Number(avgRating.toFixed(1));
    }

    return res.json({
      isSuccess: true,
      data: {
        averageRating: avgRating,
        totalReviews: reviews.length,
        reviews: reviews,
      },
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
