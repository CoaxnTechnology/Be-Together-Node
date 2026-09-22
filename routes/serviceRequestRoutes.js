const express = require("express");
const router = express.Router();
const authMiddleware = require("../Middleware/authMiddleware");
const { optionalAuth } = require("../Middleware/optionalAuth");
const serviceRequestController = require("../controller/serviceRequestController");

router.post("/create", authMiddleware, serviceRequestController.createServiceRequest);

// Dedicated "Service Requests" page listing — same lat/long + radius pattern
// as POST /api/service/get, but for ServiceRequest. Guests can view it too
// (optionalAuth), matching how the main service listing works.
router.post("/list", optionalAuth, serviceRequestController.getServiceRequests);

router.get("/my", authMiddleware, serviceRequestController.getMyServiceRequests);
router.get("/:id", authMiddleware, serviceRequestController.getServiceRequestById);
router.put(
  "/:id/status",
  authMiddleware,
  serviceRequestController.updateServiceRequestStatus,
);
router.delete("/:id", authMiddleware, serviceRequestController.deleteServiceRequest);

module.exports = router;
