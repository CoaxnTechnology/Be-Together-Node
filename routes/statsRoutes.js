const express = require("express");
const { getStats } = require("../controller/statsController");

const router = express.Router();

// GET /api/stats?days=7
// Optional query param: days (default = 7)
router.get("/", (req, res) => {
  console.log("🔹 Stats API called with query:", req.query);
  getStats(req, res);
});

module.exports = router;
