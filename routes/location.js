// routes/location.js
const express = require('express');
const router = express.Router();

const authMiddleware = require('../Middleware/authMiddleware');

const { location } = require('../controller/Location');

router.post("/location", authMiddleware, location);

module.exports = router;
