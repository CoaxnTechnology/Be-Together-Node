// routes/location.js
const express = require('express');
const router = express.Router();

const authMiddleware = require('../Middleware/authMiddleware');
// two safe options below — pick one:

// Option A: destructure the exported handler
const { location } = require('../controller/Location');

// Option B: import whole module and reference .location
// const locationController = require('../controller/Location');
// const location = locationController.location;

router.post("/location", authMiddleware, location);

module.exports = router;
