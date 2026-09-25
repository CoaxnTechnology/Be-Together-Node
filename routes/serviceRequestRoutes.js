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
// Public — anyone can view a request. Pass ?userId=<viewer id> so the
// response can tell the creator not to show the booking button.
router.get("/:id", serviceRequestController.getServiceRequestById);
router.put(
  "/:id/status",
  authMiddleware,
  serviceRequestController.updateServiceRequestStatus,
);
router.delete("/:id", authMiddleware, serviceRequestController.deleteServiceRequest);

// ⭐ Booking flows (client-finalized 24 Sep 2026)
// Category A — Paid, Fixed Price: book a seat directly.
router.post("/:id/book", authMiddleware, serviceRequestController.bookFixedRequest);

// Category B — Paid, Offer-Based: submit / list / withdraw / accept.
router.post("/:id/offers", authMiddleware, serviceRequestController.submitOffer);
router.get("/:id/offers", authMiddleware, serviceRequestController.listOffers);
router.delete(
  "/:id/offers/:offerId",
  authMiddleware,
  serviceRequestController.withdrawOffer,
);
router.post(
  "/:id/offers/:offerId/accept",
  authMiddleware,
  serviceRequestController.acceptOffer,
);

// Category C & D — Free (single) / Free Group: Join.
router.post("/:id/join", authMiddleware, serviceRequestController.joinRequest);

module.exports = router;
