const express = require("express");

const router = express.Router();

const {
  getDeletedUsers,
  getDeletedUserById,
  deleteAccount,
} = require("../controller/deleteaccountcontroller");

// deleted users list
router.get("/deleted-users", getDeletedUsers);

// deleted user details
router.get("/deleted-users/:backupId", getDeletedUserById);

// DELETE ACCOUNT
router.delete("/delete-account", deleteAccount);

module.exports = router;
