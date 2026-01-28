const express = require("express");
const { getStats } = require("../controller/statsController");

const router = express.Router();

// GET /api/stats
router.get("/", getStats);

module.exports = router;
//stats