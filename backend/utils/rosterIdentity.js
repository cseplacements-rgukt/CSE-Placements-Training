// Roster-student identity resolution for hot exam-time routes.
//
// Student JWTs carry extended claims (name/idNumber/batchYear) signed at
// login, so /start, /auto-save, submit and the proctoring endpoints can
// build identity snapshots and scope queries WITHOUT a Mongo round trip.
// Tokens issued before the extended claims existed fall back to a single
// lookup. Any non-roster token resolves to null.
const User = require("../models/User");

// Full identity (id + snapshot fields) — for routes that stamp snapshots.
async function resolveRosterStudent(req) {
  if (req.user?.authType !== "student-roster" || !req.user.studentId) {
    return null;
  }
  if (
    req.user.name &&
    req.user.idNumber &&
    Number.isFinite(req.user.batchYear)
  ) {
    return {
      _id: req.user.studentId,
      email: req.user.email,
      name: req.user.name,
      idNumber: req.user.idNumber,
      batchYear: req.user.batchYear,
    };
  }
  try {
    const user = await User.findById(req.user.studentId).lean();
    return user && user.role === "student" ? user : null;
  } catch {
    return null;
  }
}

// Bare id — for routes that only scope writes by studentId.
function rosterStudentIdFromToken(req) {
  if (req.user?.authType !== "student-roster" || !req.user.studentId) {
    return null;
  }
  return req.user.studentId;
}

module.exports = { resolveRosterStudent, rosterStudentIdFromToken };
