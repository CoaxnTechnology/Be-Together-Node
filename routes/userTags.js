// routes/userTags.js
const express = require("express");
const router = express.Router();
const { updateUserTags } = require("../controller/updateUserTags");
//const { checkAuth } = require("../middleware/auth"); // assume exists

router.post("/tags", updateUserTags);

module.exports = router;
