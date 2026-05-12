const express = require("express");

const router = express.Router();

const { getWallet } = require("../controller/walletController");

router.get("/:userId", getWallet);

module.exports = router;
