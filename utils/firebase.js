const admin = require("firebase-admin");
const fs = require("fs");

if (!admin.apps.length) {
  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (!serviceAccountPath) {
      console.log("⚠️ FIREBASE_SERVICE_ACCOUNT_PATH not set, Firebase disabled");
    } else {
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      console.log("✅ Firebase initialized successfully");
    }
  } catch (err) {
    console.error("❌ Firebase init failed:", err.message);
  }
}

module.exports = admin;