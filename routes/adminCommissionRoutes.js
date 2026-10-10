const express = require("express");
const router = express.Router();
const adminCommissionController = require("../controller/adminCommissionController");

router.get("/", adminCommissionController.getCommission);
router.put("/", adminCommissionController.updateCommission);

// Service Request late cancellation charge (fee % + BeTogether's share).
router.get("/request-cancellation", adminCommissionController.getRequestCancellation);
router.post("/request-cancellation", adminCommissionController.saveRequestCancellation);
router.put("/request-cancellation", adminCommissionController.saveRequestCancellation);
router.delete("/request-cancellation", adminCommissionController.deleteRequestCancellation);

module.exports = router;
