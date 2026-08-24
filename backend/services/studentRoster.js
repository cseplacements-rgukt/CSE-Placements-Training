/*
 * Student roster management — shared by /api/students routes and seed
 * scripts. Roster students authenticate with ID/email + their OWN exam-cell
 * password (the college-issued one used for email/results); they never touch
 * Firebase.
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const COLLEGE_EMAIL_DOMAIN = "rguktsklm.ac.in";

const deriveEmail = (idNumberNormalized) =>
  `${idNumberNormalized}@${COLLEGE_EMAIL_DOMAIN}`;

const normalizeIdNumber = (raw) => String(raw || "").trim().toLowerCase();

class RosterError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Validates and hashes a per-student exam-cell password.
 * The college's real exam-cell passwords have no fixed shape, so any
 * printable password of reasonable length is accepted.
 * @returns {Promise<string>} bcrypt hash, or null when no password given
 */
async function hashRosterPassword(password) {
  const trimmed = String(password || "").trim();
  if (!trimmed) return null;
  if (trimmed.length < 4 || trimmed.length > 64) {
    throw new RosterError(400, "Password must be between 4 and 64 characters");
  }
  return bcrypt.hash(trimmed, 10);
}

/**
 * Adds one student to the roster.
 * @param {Object} opts
 * @param {string} opts.idNumber
 * @param {string} opts.name
 * @param {number|string} opts.batchYear
 * @param {string} [opts.password] - student's individual exam-cell password;
 *   omitted/empty means the account starts on the legacy shared password.
 * @returns {Promise<Object>} created student document
 */
async function addStudentToRoster({ idNumber, name, batchYear, password }) {
  if (!String(idNumber || "").trim()) {
    throw new RosterError(400, "ID number is required");
  }
  if (!String(name || "").trim()) {
    throw new RosterError(400, "Name is required");
  }
  const year = parseInt(batchYear);
  if (!year || year < 2000 || year > 2100) {
    throw new RosterError(400, "A valid batch year is required");
  }

  // No format/prefix validation on purpose: campus-origin letters vary
  // across RGUKT campuses and repeating seniors keep old IDs.
  const normalized = normalizeIdNumber(idNumber);
  const email = deriveEmail(normalized);

  const existing = await User.findOne({
    $or: [{ idNumberNormalized: normalized }, { email }],
  });
  if (existing) {
    throw new RosterError(
      409,
      `A student with ID ${existing.idNumber || normalized} already exists`,
    );
  }

  const doc = {
    firebaseUid: `roster:${normalized}`,
    email,
    name: String(name).trim(),
    role: "student",
    idNumber: String(idNumber).trim(),
    idNumberNormalized: normalized,
    batchYear: year,
  };

  const passwordHash = await hashRosterPassword(password);
  if (passwordHash) doc.passwordHash = passwordHash;

  return User.create(doc);
}

module.exports = {
  COLLEGE_EMAIL_DOMAIN,
  addStudentToRoster,
  hashRosterPassword,
  deriveEmail,
  normalizeIdNumber,
  RosterError,
};
