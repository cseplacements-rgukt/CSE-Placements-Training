const mongoose = require("mongoose");

// Legacy role names are mapped forward so accounts written under an older
// enum keep working after a rename instead of failing validation on their
// next save/login.
const ROLE_ALIASES = {
  teacher: "coordinator",
  tnpc_admin: "coordinator", // pre-2026 name of the coordinator role
  tnpcadmin: "coordinator",
  "tnpc-admin": "coordinator",
  // The standalone proctor role was retired: session review moved to the
  // exam-team tiers. Legacy accounts remap on their next save/login.
  proctor: "coordinator",
};

// Staff hierarchy: super_admin > admin > coordinator. Students sit outside
// that chain. Roster students live in this same collection
// (Submission/ProctoringSession reference User._id) but never touch
// Firebase: they authenticate with ID/email + the shared exam-cell password
// against backend-issued JWTs, identified by the synthetic `roster:`
// firebaseUid prefix.
const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["student", "coordinator", "admin", "super_admin"],
    default: "student",
  },
  // ── Roster-student fields (staff accounts leave these empty) ──────────
  // Display form exactly as entered by staff; no format/prefix validation
  // because campus-of-origin letters vary across RGUKT campuses.
  idNumber: { type: String },
  // Lowercased trimmed copy of idNumber used for uniqueness + login lookup.
  idNumberNormalized: {
    type: String,
    unique: true,
    sparse: true,
  },
  // Manual batch assignment at add/import time (never parsed from the ID).
  batchYear: { type: Number },
  // Per-student exam-cell password (bcrypt). The college issues every student
  // their OWN password — the same one used for college email / results — so
  // roster imports now carry one password per row. `select: false` keeps it
  // out of every query unless explicitly requested. When null, login falls
  // back to the legacy shared exam-cell password.
  passwordHash: { type: String, select: false, default: null },
  // Two-Factor Authentication fields
  twoFactorEnabled: {
    type: Boolean,
    default: false,
  },
  twoFactorSecret: {
    type: String,
  },
  // Login failure tracking (REQ-19)
  failedLoginAttempts: {
    type: Number,
    default: 0,
  },
  accountLockedUntil: {
    type: Date,
    default: null,
  },
  // Profile and status
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLogin: {
    type: Date,
  },
  profileImage: {
    type: String,
  },
  // For proctoring reference image
  referenceImage: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

userSchema.pre("validate", function (next) {
  const normalizedRole = String(this.role || "").trim().toLowerCase();
  if (ROLE_ALIASES[normalizedRole]) {
    this.role = ROLE_ALIASES[normalizedRole];
  }
  if (this.isModified("idNumber")) {
    const trimmed = String(this.idNumber || "").trim();
    this.idNumber = trimmed;
    if (trimmed) {
      this.idNumberNormalized = trimmed.toLowerCase();
    } else {
      this.idNumberNormalized = undefined;
    }
  } else if (!this.idNumber) {
    this.idNumberNormalized = undefined;
  }
  next();
});

// Update timestamp on save
userSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("User", userSchema);
module.exports.ROLE_ALIASES = ROLE_ALIASES;
