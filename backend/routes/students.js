const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");
const {
  addStudentToRoster,
  hashRosterPassword,
  RosterError,
} = require("../services/studentRoster");

const COLLEGE_EMAIL_DOMAIN = "rguktsklm.ac.in";
const MAX_IMPORT_ROWS = 1000;

// Roster management is restricted to admin/super_admin — coordinators run
// exams but do not manage student accounts.
const requireRosterManager = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({
        message: "Only admins can manage the student roster",
      });
    }
    req.managerUser = user;
    next();
  } catch (error) {
    console.error("Error in requireRosterManager:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const deriveEmail = (idNumberNormalized) =>
  `${idNumberNormalized}@${COLLEGE_EMAIL_DOMAIN}`;

const normalizeIdNumber = (raw) => String(raw || "").trim().toLowerCase();

// Hard-deletes a roster student's LOGIN/roster entry. Their Submission and
// ProctoringSession records are deliberately KEPT (denormalized identity
// snapshots on those documents keep them attributable) so the placement cell
// retains year-over-year performance history after a batch graduates. Only
// account-scoped ephemeral data (notifications) goes with the account.
async function hardDeleteStudents(studentIds) {
  await Notification.deleteMany({ userId: { $in: studentIds } });
  const { deletedCount } = await User.deleteMany({ _id: { $in: studentIds } });
  return deletedCount;
}

// ─── List students ──────────────────────────────────────────────────
router.get(
  "/",
  verifyFirebaseToken,
  requireRosterManager,
  async (req, res) => {
    try {
      const { batchYear, search, page = 1, limit = 50 } = req.query;

      const query = { role: "student" };
      if (batchYear) query.batchYear = parseInt(batchYear);
      if (search) {
        const normalizedSearch = String(search).trim().toLowerCase();
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { idNumber: { $regex: search, $options: "i" } },
          { idNumberNormalized: normalizedSearch },
          { email: normalizedSearch },
        ];
      }

      const students = await User.find(query)
        .select("name email idNumber batchYear isActive lastLogin createdAt")
        .sort({ batchYear: -1, name: 1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));

      const total = await User.countDocuments(query);

      res.json({
        students,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / Math.max(1, parseInt(limit))),
        },
      });
    } catch (error) {
      console.error("Error listing students:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// ─── Batch summary (distinct years + counts) ────────────────────────
router.get(
  "/batches",
  verifyFirebaseToken,
  requireRosterManager,
  async (req, res) => {
    try {
      const batches = await User.aggregate([
        { $match: { role: "student" } },
        {
          $group: {
            _id: "$batchYear",
            count: { $sum: 1 },
            activeCount: {
              $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: -1 } },
      ]);
      res.json({ batches });
    } catch (error) {
      console.error("Error listing batches:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// ─── Add one student ────────────────────────────────────────────────
router.post(
  "/",
  verifyFirebaseToken,
  requireRosterManager,
  async (req, res) => {
    try {
      const student = await addStudentToRoster(req.body);

      res.status(201).json({
        student: {
          _id: student._id,
          name: student.name,
          email: student.email,
          idNumber: student.idNumber,
          batchYear: student.batchYear,
          isActive: student.isActive,
        },
        message: "Student added to roster",
      });
    } catch (error) {
      if (error instanceof RosterError || error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      if (error.code === 11000) {
        return res
          .status(409)
          .json({ message: "Duplicate ID number or email" });
      }
      console.error("Error adding student:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// ─── Bulk import (CSV text or pre-parsed rows) ──────────────────────
// Accepts either { csv: "id,name,batch,password\n..." } or
// { rows: [{ idNumber, name, batchYear, password }] }. A header row is
// auto-detected and skipped. Duplicate IDs are skipped individually, never
// fatal. `password` is REQUIRED on every row — each student's own college
// exam-cell password (the one they already use for results), stored
// bcrypt-hashed. Students log in with ID/email + that password.
router.post(
  "/import",
  verifyFirebaseToken,
  requireRosterManager,
  async (req, res) => {
    try {
      let rows = req.body.rows;
      if ((!rows || !Array.isArray(rows)) && req.body.csv) {
        rows = parseCsv(req.body.csv);
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          message: "Provide CSV text or a non-empty rows array",
        });
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({
          message: `Import is limited to ${MAX_IMPORT_ROWS} rows per request`,
        });
      }

      const results = { created: 0, skippedDuplicates: 0, errors: [] };

      for (let i = 0; i < rows.length; i += 1) {
        const { idNumber, name, batchYear, password } = rows[i] || {};
        try {
          if (!String(idNumber || "").trim() || !String(name || "").trim()) {
            throw new Error("Missing ID or name");
          }
          const year = parseInt(batchYear);
          if (!year || year < 2000 || year > 2100) {
            throw new Error(`Invalid batch year "${batchYear}"`);
          }
          if (!String(password || "").trim()) {
            throw new Error(
              "Missing exam-cell password (column 4) — use the student's college-issued password",
            );
          }
          const normalized = normalizeIdNumber(idNumber);
          const email = deriveEmail(normalized);

          const dup = await User.findOne({
            $or: [{ idNumberNormalized: normalized }, { email }],
          }).select("_id");
          if (dup) {
            results.skippedDuplicates += 1;
            continue;
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

          await User.create(doc);
          results.created += 1;
        } catch (rowError) {
          results.errors.push({
            row: i + 1,
            idNumber: idNumber || "",
            message: rowError.message,
          });
        }
      }

      res.json({ results, message: `Imported ${results.created} students` });
    } catch (error) {
      console.error("Error importing students:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

function parseCsv(csvText) {
  const lines = String(csvText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (/^id ?number$/i.test(cols[0]) && /^name$/i.test(cols[1] || "")) {
      continue; // header row
    }
    if (cols.length >= 2) {
      rows.push({
        idNumber: cols[0],
        name: cols[1],
        batchYear: cols[2],
        password: cols[3],
      });
    }
  }
  return rows;
}

// ─── Set / reset ONE student's exam-cell password ────────────────────
router.put(
  "/:id/password",
  verifyFirebaseToken,
  requireRosterManager,
  async (req, res) => {
    try {
      const student = await User.findById(req.params.id);
      if (!student || student.role !== "student") {
        return res.status(404).json({ message: "Student not found" });
      }
      try {
        const passwordHash = await hashRosterPassword(req.body.password);
        if (!passwordHash) {
          return res.status(400).json({ message: "Password is required" });
        }
        student.passwordHash = passwordHash;
        await student.save();
      } catch (pwError) {
        if (pwError.status) {
          return res.status(pwError.status).json({ message: pwError.message });
        }
        throw pwError;
      }
      res.json({
        message: `Password updated for ${student.name} (${student.idNumber})`,
      });
    } catch (error) {
      console.error("Error setting student password:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// ─── Delete single student (hard delete + cascade) ──────────────────
// Destructive: super_admin exclusive.
router.delete(
  "/:id",
  verifyFirebaseToken,
  requireRosterManager,
  async (req, res) => {
    try {
      if (req.managerUser.role !== "super_admin") {
        return res.status(403).json({
          message: "Only a super admin can delete student records",
        });
      }

      const student = await User.findById(req.params.id);
      if (!student || student.role !== "student") {
        return res.status(404).json({ message: "Student not found" });
      }

      await hardDeleteStudents([student._id]);

      res.json({
        message: `Deleted ${student.name} (${student.idNumber}). Their past submissions are kept for reporting.`,
      });
    } catch (error) {
      console.error("Error deleting student:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// ─── Delete an entire batch (hard delete + cascade) ─────────────────
// Irreversible bulk action: requires the caller to type the batch year as
// explicit confirmation. Super_admin only.
router.post(
  "/delete-batch",
  verifyFirebaseToken,
  requireRosterManager,
  async (req, res) => {
    try {
      if (req.managerUser.role !== "super_admin") {
        return res.status(403).json({
          message: "Only a super admin can delete an entire batch",
        });
      }

      const { batchYear, confirmBatchYear } = req.body;
      const year = parseInt(batchYear);
      if (!year || year < 2000 || year > 2100) {
        return res.status(400).json({ message: "A valid batch year is required" });
      }
      if (String(confirmBatchYear || "").trim() !== String(year)) {
        return res.status(400).json({
          message:
            "Confirmation failed: type the exact batch year to enable this irreversible deletion",
        });
      }

      const students = await User.find({ role: "student", batchYear: year })
        .select("_id")
        .lean();

      if (students.length === 0) {
        return res
          .status(404)
          .json({ message: `No students found in batch ${year}` });
      }

      const deletedCount = await hardDeleteStudents(students.map((s) => s._id));

      res.json({
        message: `Deleted ${deletedCount} students from batch ${year}. Their submissions and proctoring history are kept for reporting.`,
        deletedCount,
      });
    } catch (error) {
      console.error("Error deleting batch:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

module.exports = router;
