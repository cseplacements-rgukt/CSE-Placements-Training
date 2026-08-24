/**
 * Mint Firebase ID tokens for k6 load-test users.
 *
 * k6 cannot talk to the Firebase client SDK, so this helper:
 *   1. creates N synthetic students in MongoDB (role: student,
 *      firebaseUid: loadtest-<i>), if MONGO_URI is provided,
 *   2. mints a Firebase custom token per user,
 *   3. exchanges it at the Identity Toolkit REST API for a real ID token,
 *   4. writes tokens.json consumed by k6-exam.js.
 *
 * Usage:
 *   cd backend
 *   GOOGLE_APPLICATION_CREDENTIALS=/etc/modugo/firebase-service-account.json \
 *   FIREBASE_WEB_API_KEY=<web-api-key> \
 *   MONGO_URI=mongodb+srv://... COUNT=250 node ../deploy/loadtest/mint-tokens.js
 *
 * Tokens live ~1 h — mint right before running k6.
 */
const fs = require("fs");

async function main() {
  const count = parseInt(process.env.COUNT || "50", 10);
  const webApiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!webApiKey) throw new Error("FIREBASE_WEB_API_KEY is required for token exchange");
  require("../../backend/config/firebase"); // initializes firebase-admin from env/credentials

  // Optional: ensure matching student profiles exist in MongoDB
  if (process.env.MONGO_URI) {
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.MONGO_URI);
    const User = require("../../backend/models/User");
    const bulk = [];
    for (let i = 0; i < count; i++) {
      const uid = `loadtest-${i}`;
      bulk.push({
        updateOne: {
          filter: { firebaseUid: uid },
          update: {
            $set: {
              firebaseUid: uid,
              email: `${uid}@loadtest.rgukt`,
              name: `Load Test ${i}`,
              role: "student",
            },
          },
          upsert: true,
        },
      });
    }
    await User.bulkWrite(bulk);
    console.log(`Seeded ${count} load-test students`);
    await mongoose.disconnect();
  }

  const admin = require("firebase-admin");
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const uid = `loadtest-${i}`;
    const customToken = await admin.auth().createCustomToken(uid);
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${webApiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    );
    if (!res.ok) throw new Error(`Exchange failed for ${uid}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    tokens.push(data.idToken);
    process.stdout.write(`\rMinted ${i + 1}/${count}`);
  }
  fs.writeFileSync(__dirname + "/tokens.json", JSON.stringify(tokens));
  console.log(`\nWrote ${tokens.length} tokens to deploy/loadtest/tokens.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
