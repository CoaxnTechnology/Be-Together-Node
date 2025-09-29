const express = require("express");
const { createReview, getServiceReviews } = require("../controller/Review");
const authMiddleware = require("../Middleware/authMiddleware");

const router = express.Router();
router.post("/createreviews",authMiddleware, createReview);
router.get("/getreviews", getServiceReviews);

module.exports = router;