const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const AppSetting = require("../models/AppSetting");

const EXAM_CELL_PASSWORD_KEY = "exam_cell_password_hash";

// Exam-cell password format: exactly 5 chars made of 3 letters + 2 digits
// in any order (e.g. ABC12 or O3C6U). Compared case-insensitively by
// uppercasing both sides so a student typing o3c6u is not locked out of the
// account admin provisioned.
const isValidShape = (value) => {
  const p = String(value || "").trim();
  return (
    p.length === 5 &&
    (p.match(/[A-Za-z]/g) || []).length === 3 &&
    (p.match(/[0-9]/g) || []).length === 2
  );
};

const normalizePassword = (password) => String(password || "").trim().toUpperCase();

const isValidExamCellPassword = (password) => isValidShape(normalizePassword(password));

const generateExamCellPassword = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  let out = "";
  for (let i = 0; i < 3; i += 1) {
    out += letters[cryptoRandomInt(letters.length)];
  }
  for (let i = 0; i < 2; i += 1) {
    out += digits[cryptoRandomInt(digits.length)];
  }
  return out;
};

function cryptoRandomInt(max) {
  // Uniform rejection sampling over [0, max)
  const range = 256 - (256 % max);
  const buf = Buffer.alloc(1);
  do {
    crypto.randomFillSync(buf);
  } while (buf[0] >= range);
  return buf[0] % max;
}

const setExamCellPassword = async (password) => {
  const normalized = normalizePassword(password);
  if (!isValidShape(normalized)) {
    throw new Error("Password must be exactly 5 characters: 3 letters and 2 digits (e.g. O3C6U)");
  }
  const hash = await bcrypt.hash(normalized, 10);
  await AppSetting.setValue(EXAM_CELL_PASSWORD_KEY, hash);
  return normalized;
};

const verifyExamCellPassword = async (candidate) => {
  const hash = await AppSetting.getValue(EXAM_CELL_PASSWORD_KEY);
  if (!hash) return false;
  return bcrypt.compare(normalizePassword(candidate), hash);
};

const getExamCellPasswordStatus = async () => {
  const doc = await AppSetting.findOne({ key: EXAM_CELL_PASSWORD_KEY }).select(
    "updatedAt",
  );
  return { configured: Boolean(doc), updatedAt: doc ? doc.updatedAt : null };
};

module.exports = {
  EXAM_CELL_PASSWORD_KEY,
  isValidExamCellPassword,
  generateExamCellPassword,
  normalizePassword,
  setExamCellPassword,
  verifyExamCellPassword,
  getExamCellPasswordStatus,
};
