// firebaseAdmin.js
const admin = require("firebase-admin");

let firebaseInitialized = false;

if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT not set, Firebase disabled");
  } else {
    try {
      const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT
      );

      // Fix newlines in private key
      if (serviceAccount.private_key) {
        serviceAccount.private_key =
          serviceAccount.private_key.replace(/\\n/g, "\n");
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      firebaseInitialized = true;
      console.log("✅ Firebase Admin initialized successfully");
    } catch (err) {
      console.error("❌ Firebase init failed:", err.message);
    }
  }
}

module.exports = {
  admin,
  firebaseInitialized,
};
