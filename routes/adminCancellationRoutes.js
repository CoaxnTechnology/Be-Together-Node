const express = require("express");
const router = express.Router();
const ctrl = require("../controller/adminCancellationController");

router.put("/", ctrl.updateCancellationSetting);

router.get("/", ctrl.getCancellationSetting);
router.get("/", async (req, res) => {
  const setting = await require("../model/CancellationSetting").findOne();
  res.json(setting);
});

module.exports = router;
