const express = require("express");
const router = express.Router();
const controller = require("../controller/promotionPlanadmin.controller");

router.post("/admin/create-promotion-plan", controller.createPromotionPlan);
router.get("/admin/promotion-plans", controller.getPromotionPlans);
router.put("/admin/promotion-plan/:id", controller.updatePromotionPlan);
router.delete("/admin/promotion-plan/:id", controller.deletePromotionPlan);

module.exports = router;
