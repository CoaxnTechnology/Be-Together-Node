const express = require("express");

const router = express.Router();

const {
  createWalletConfig,
  getWalletConfig,
  updateWalletConfig,
  deleteWalletConfig,
} = require("../controller/adminWalletConfigController");
const auth=require("../middleware/adminAuth");
// ADD
router.post("/wallet-config", auth, createWalletConfig);

// GET
router.get("/wallet-config", auth, getWalletConfig);

// EDIT
router.put("/wallet-config/:id", auth, updateWalletConfig);

// DELETE
router.delete("/wallet-config/:id", auth, deleteWalletConfig);

module.exports = router;
