const admin = require("firebase-admin");
const dotenv = require("dotenv");

dotenv.config();

const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  : undefined;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
  storageBucket: process.env.FIREBASE_PROJECT_ID + ".firebasestorage.app"
});

async function setCors() {
  try {
    const bucket = admin.storage().bucket();
    
    console.log("Setting CORS on bucket:", bucket.name);
    
    await bucket.setCorsConfiguration([
      {
        origin: ["http://localhost:5173", "http://localhost:5174"],
        method: ["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS"],
        maxAgeSeconds: 3600,
        responseHeader: ["Content-Type", "Authorization", "Content-Length", "User-Agent", "x-goog-resumable"]
      }
    ]);
    
    console.log("Successfully updated CORS configuration for", bucket.name);
  } catch (error) {
    console.error("Failed to set CORS:", error);
  }
}

setCors();
