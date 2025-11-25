// routes/userTags.js
const express = require("express");
const router = express.Router();
const { updateUserTags, getProviderProfile } = require("../controller/updateUserTags");
//const { checkAuth } = require("../middleware/auth"); // assume exists

router.post("/tags", updateUserTags);
router.post("/user/perfromance",getProviderProfile)

module.exports = router;
