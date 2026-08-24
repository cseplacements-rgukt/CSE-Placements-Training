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
    },
    JWT_SECRET,
    { subject: String(user._id), expiresIn: STUDENT_TOKEN_TTL },
  );

const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split("Bearer ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
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
  } catch (jwtError) {
    // Not a valid roster token — fall through to Firebase verification.
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
    console.error("Error verifying token:", error?.message || error);
    return res.status(403).json({ message: "Invalid token" });
  }
};

module.exports = verifyAuth;
module.exports.signStudentToken = signStudentToken;
module.exports.JWT_SECRET = JWT_SECRET;
module.exports.STUDENT_TOKEN_TTL = STUDENT_TOKEN_TTL;
