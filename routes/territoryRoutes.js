const express = require("express");

const router = express.Router();

const territoryController = require("../controller/territoryController");

const adminAuth = require("../Middleware/adminAuth");

// CREATE
router.post("/territories", adminAuth, territoryController.createTerritory);

// GET ALL
router.get("/territories", adminAuth, territoryController.getAllTerritories);

// GET ONE
router.get(
  "/territories/:territoryId",
  adminAuth,
  territoryController.getTerritoryById,
);

// UPDATE
router.put(
  "/territories/:territoryId",
  adminAuth,
  territoryController.updateTerritory,
);

// DELETE
router.delete(
  "/territories/:territoryId",
  adminAuth,
  territoryController.deleteTerritory,
);

// ASSIGN EXCLUSIVE AMBASSADOR
router.post(
  "/territories/:territoryId/assign",
  adminAuth,
  territoryController.assignExclusiveAmbassador,
);

module.exports = router;
