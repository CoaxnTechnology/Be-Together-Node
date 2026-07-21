const express = require("express");

const router = express.Router();

const {
  getDeletedUsers,
  getDeletedUserById,
  deleteAccount,
} = require("../controller/deleteaccountcontroller");
const auth = require("../Middleware/authMiddleware");
const adminAuth = require("../Middleware/adminAuth");
// deleted users list
router.get("/deleted-users", getDeletedUsers);

// deleted user details
router.get("/deleted-users/:backupId",adminAuth, getDeletedUserById);

// DELETE ACCOUNT
router.delete("/delete-account", auth, deleteAccount);

module.exports = router;
