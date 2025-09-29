const express = require("express");
const { createReview, getServiceReviews } = require("../controller/Review");

const router = express.Router();
router.post("/createreviews", createReview);
router.get("/getreviews", getServiceReviews);

module.exports = router;