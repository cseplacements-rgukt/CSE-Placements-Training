const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const admin = require("../config/firebase");

// Students are NOT Firebase users. Roster login issues a backend JWT; staff
// keep authenticating with Firebase ID tokens. This middleware accepts both
// and normalises them into the same req.user shape ({ uid, ... }) that every
// route already consumes via User.findOne({ firebaseUid: req.user.uid }).
//
// SECURITY: the signing secret must come from STUDENT_JWT_SECRET. There is
// deliberately NO hardcoded fallback — a constant in source would let anyone
// who has seen the code forge student JWTs without knowing the exam-cell
// password. If the env var is missing we generate an in-memory random secret:
// it is safe for that process, but every restart silently invalidates all
// active student sessions, so set a stable value via .env in real use.
let JWT_SECRET = process.env.STUDENT_JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(48).toString("hex");
  console.warn(
    "┌──────────────────────────────────────────────────────────────────┐\n" +
      "│ WARNING: STUDENT_JWT_SECRET is not set. Using an EPHEMERAL       │\n" +
      "│ auto-generated secret for this process only. Every server        │\n" +
      "│ restart will invalidate all active student sessions and any      │\n" +
      "│ multi-instance deployment will not share them. Generate a        │\n" +
      "│ stable value with:                                               │\n" +
      "│   node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\" │\n" +
      "│ …and set STUDENT_JWT_SECRET in backend/.env before real use.     │\n" +
      "└──────────────────────────────────────────────────────────────────┘",
  );
}
const STUDENT_TOKEN_TTL = process.env.STUDENT_TOKEN_TTL || "12h";

const signStudentToken = (user) =>
  jwt.sign(
    {
      uid: user.firebaseUid,
      email: user.email,
      role: "student",
      authType: "student-roster",
      // Extended claims so hot routes (/start, /auto-save, submit) can build
      // identity snapshots WITHOUT hitting Mongo. undefined values are
      // omitted from the token automatically.
      name: user.name || undefined,
      idNumber: user.idNumber || undefined,
      batchYear: user.batchYear ?? undefined,
    },
    JWT_SECRET,
    { subject: String(user._id), expiresIn: STUDENT_TOKEN_TTL },
  );

const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split("Bearer ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Reject obviously malformed values before touching any verifier.
  // Frontend race-conditions can send literal "null"/"undefined" strings
  // when getAuthToken() hasn't resolved yet - those must not reach
  // Firebase's verifyIdToken (which would log "no kid claim" noise).
  if (
    token === "null" ||
    token === "undefined" ||
    token.trim() === ""
  ) {
    return res.status(401).json({ message: "Invalid token" });
  }

  // 1) Backend-issued roster-student token.
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload && payload.authType === "student-roster") {
      req.user = {
        uid: payload.uid,
        email: payload.email,
        role: payload.role,
        studentId: payload.sub,
        authType: "student-roster",
      };
      return next();
    }
    // Valid JWT but not a roster token - don't fall through silently,
    // continue to Firebase path (e.g. a future HS256 staff token).
  } catch (jwtError) {
    // TokenExpiredError means it WAS a roster token but session elapsed.
    // Returning here avoids the noisy Firebase "no kid claim" fallback.
    if (jwtError?.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please sign in again." });
    }
    // For any other jwt error (invalid signature, malformed) fall
    // through to Firebase verification - the token might be a Firebase
    // ID token instead. Intentionally no log here; this is expected.
  }

  // 2) Firebase ID token (staff accounts).
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (!decodedToken || !decodedToken.uid) {
      throw new Error("Firebase verification returned no identity");
    }
    req.user = decodedToken;
    next();
  } catch (error) {
    // Firebase's "no kid claim" is expected when a roster JWT or garbage
    // reaches this branch. Log at debug level only to avoid flooding
    // production logs during mass expiry / polling bursts. The client
    // already gets a 401/403; no stack needed.
    const msg = error?.message || String(error);
    const isKidError = msg.includes('kid');
    if (!isKidError) {
      // Genuine Firebase failure (bad projectId, revoked token) - keep visible
      console.warn("Firebase token verification failed:", msg);
    } else if (process.env.NODE_ENV !== "production") {
      console.debug("Firebase verify fallback missed (expected for roster/garbage token):", msg);
    }
    return res.status(403).json({ message: "Invalid token" });
  }
};

module.exports = verifyAuth;
module.exports.signStudentToken = signStudentToken;
module.exports.JWT_SECRET = JWT_SECRET;
module.exports.STUDENT_TOKEN_TTL = STUDENT_TOKEN_TTL;
