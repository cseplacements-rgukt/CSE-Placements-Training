const express = require("express");
const router = express.Router();
const Report = require("../models/Report");
const { applyStudentSnapshotFallback } = require("../utils/studentSnapshot");
const User = require("../models/User");
const Exam = require("../models/Exam");
const Submission = require("../models/Submission");
const ProctoringSession = require("../models/ProctoringSession");
const verifyFirebaseToken = require("../middleware/auth");

// Generate a new report
router.post("/generate", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid }).lean();
    if (!user || !["admin", "super_admin", "coordinator"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { type, startDate, endDate, format } = req.body;

    const start = new Date(startDate);
    const end = new Date(endDate);

    let reportData = {};

    switch (type) {
      case "exam_analytics":
        reportData = await generateExamAnalytics(user, start, end);
        break;
      case "student_performance":
        reportData = await generateStudentPerformance(start, end);
        break;
      case "proctoring_summary":
        reportData = await generateProctoringSummary(start, end);
        break;
      case "system_usage":
        reportData = await generateSystemUsage(start, end);
        break;
      case "flagged_submissions":
        reportData = await generateFlaggedSubmissions(user, start, end);
        break;
      default:
        return res.status(400).json({ message: "Invalid report type" });
    }

    const report = new Report({
      type,
      title: `${type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} Report`,
      generatedBy: user._id,
      startDate: start,
      endDate: end,
      data: reportData,
      format: format || "json",
      status: "generated",
    });

    await report.save();
    res.status(201).json({ report });
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all reports
router.get("/", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["admin", "super_admin", "coordinator"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const query = ["admin", "super_admin"].includes(user.role) ? {} : { generatedBy: user._id };
    const reports = await Report.find(query)
      .populate("generatedBy", "name email")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ reports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get report by ID
router.get("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["admin", "super_admin", "coordinator"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const report = await Report.findById(req.params.id)
      .populate("generatedBy", "name email")
      .lean();

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Teachers can only see their own reports
    if (
      user.role === "coordinator" &&
      report.generatedBy._id.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ report });
  } catch (error) {
    console.error("Error fetching report:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete report
router.delete("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["admin", "super_admin", "coordinator"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const report = await Report.findById(req.params.id).lean();
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Non-super-admin tiers may only remove reports they generated
    // themselves; super_admin can moderate any report.
    if (
      user.role !== "super_admin" &&
      report.generatedBy.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: "Report deleted" });
  } catch (error) {
    console.error("Error deleting report:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard statistics (quick overview)
router.get("/stats/dashboard", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid }).lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let stats = {};

    if (["admin", "super_admin"].includes(user.role)) {
      stats = {
        totalUsers: await User.countDocuments(),
        totalStudents: await User.countDocuments({ role: "student" }),
        totalTeachers: await User.countDocuments({ role: "coordinator" }),
        totalExams: await Exam.countDocuments(),
        activeExams: await Exam.countDocuments({
          isActive: true,
          endTime: { $gte: new Date() },
        }),
        totalSubmissions: await Submission.countDocuments(),
        flaggedSubmissions: await Submission.countDocuments({
          isFlagged: true,
        }),
        recentSubmissions: await Submission.countDocuments({
          submittedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
      };
    } else if (user.role === "coordinator") {
      const teacherExams = await Exam.find({ teacherId: user._id }).lean();
      const examIds = teacherExams.map((e) => e._id);

      stats = {
        totalExams: teacherExams.length,
        activeExams: teacherExams.filter(
          (e) => e.isActive && e.endTime >= new Date(),
        ).length,
        totalSubmissions: await Submission.countDocuments({
          examId: { $in: examIds },
        }),
        averageScore: await calculateAverageScore(examIds),
        recentSubmissions: await Submission.countDocuments({
          examId: { $in: examIds },
          submittedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
      };
    } else {
      // Student stats
      stats = {
        totalExamsAttempted: await Submission.countDocuments({
          studentId: user._id,
        }),
        averageScore: await calculateStudentAverageScore(user._id),
        upcomingExams: await Exam.countDocuments({
          isActive: true,
          scheduledAt: { $gte: new Date() },
        }),
      };
    }

    res.json({ stats });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Helper functions
async function generateExamAnalytics(user, startDate, endDate) {
  const examQuery =
    ["admin", "super_admin"].includes(user.role)
      ? { createdAt: { $gte: startDate, $lte: endDate } }
      : { teacherId: user._id, createdAt: { $gte: startDate, $lte: endDate } };

  const exams = await Exam.find(examQuery).lean();
  const examIds = exams.map((e) => e._id);

  const submissions = await Submission.find({
    examId: { $in: examIds },
    submittedAt: { $gte: startDate, $lte: endDate },
  }).lean();

  const examBreakdown = await Promise.all(
    exams.map(async (exam) => {
      const examSubmissions = submissions.filter(
        (s) => s.examId.toString() === exam._id.toString(),
      );
      const scores = examSubmissions.map((s) => s.percentage);
      const avgScore =
        scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;
      const passCount = examSubmissions.filter(
        (s) => s.percentage >= (exam.settings?.passingScore || 50),
      ).length;

      return {
        examId: exam._id,
        title: exam.title,
        submissions: examSubmissions.length,
        averageScore: Math.round(avgScore),
        passRate:
          examSubmissions.length > 0
            ? Math.round((passCount / examSubmissions.length) * 100)
            : 0,
      };
    }),
  );

  return {
    totalExams: exams.length,
    totalSubmissions: submissions.length,
    averageScore: Math.round(
      submissions.reduce((a, b) => a + b.percentage, 0) /
        (submissions.length || 1),
    ),
    passRate: Math.round(
      (submissions.filter((s) => s.percentage >= 50).length /
        (submissions.length || 1)) *
        100,
    ),
    examBreakdown,
  };
}

async function generateStudentPerformance(startDate, endDate) {
  const students = await User.find({ role: "student" })
    .select("_id name")
    .lean();
  const liveIds = new Set(students.map((s) => String(s._id)));

  // Single query for all submissions in range - avoids 739 concurrent finds (was ~8s)
  const allSubs = await Submission.find({
    submittedAt: { $gte: startDate, $lte: endDate },
  })
    .select("studentId percentage isFlagged")
    .lean();
  const byStudent = new Map();
  for (const s of allSubs) {
    const key = String(s.studentId?._id ?? s.studentId);
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(s);
  }

  const studentBreakdown = students.map((student) => {
    const submissions = byStudent.get(String(student._id)) || [];
    const scores = submissions.map((s) => s.percentage);
    const avgScore =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;
    const flaggedCount = submissions.filter((s) => s.isFlagged).length;

    return {
      studentId: student._id,
      name: student.name,
      examsAttempted: submissions.length,
      averageScore: Math.round(avgScore),
      flaggedCount,
    };
  });

  // Deleted roster accounts: their submissions are intentionally kept (with
  // a denormalized identity snapshot), so include them here to preserve
  // year-over-year history that a live-user-only breakdown would lose.
  const orphaned = await Submission.find({
    submittedAt: { $gte: startDate, $lte: endDate },
  })
    .select("studentId studentName studentIdNumber batchYear percentage isFlagged")
    .lean();

  const orphansByRef = new Map();
  for (const sub of orphaned) {
    const refKey = String(sub.studentId?._id ?? sub.studentId);
    if (liveIds.has(refKey)) continue; // still an active account
    if (!orphansByRef.has(refKey)) {
      orphansByRef.set(refKey, {
        studentId: refKey,
        name: sub.studentName || "Deleted student",
        idNumber: sub.studentIdNumber || null,
        batchYear: sub.batchYear ?? null,
        deletedAccount: true,
        submissions: [],
      });
    }
    orphansByRef.get(refKey).submissions.push(sub);
  }

  for (const entry of orphansByRef.values()) {
    const scores = entry.submissions.map((s) => s.percentage);
    const avgScore =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;
    studentBreakdown.push({
      studentId: entry.studentId,
      name: entry.name,
      idNumber: entry.idNumber,
      batchYear: entry.batchYear,
      examsAttempted: entry.submissions.length,
      averageScore: Math.round(avgScore),
      flaggedCount: entry.submissions.filter((s) => s.isFlagged).length,
      deletedAccount: true,
    });
  }

  return {
    totalStudents: students.length + orphansByRef.size,
    studentBreakdown: studentBreakdown.filter((s) => s.examsAttempted > 0),
  };
}

async function generateProctoringSummary(startDate, endDate) {
  const sessions = await ProctoringSession.find({
    startedAt: { $gte: startDate, $lte: endDate },
  }).lean();

  const eventTypes = [
    "tab_switch",
    "fullscreen_exit",
    "face_not_detected",
    "multiple_faces",
    "copy_paste",
    "right_click",
    "browser_resize",
    "dev_tools_opened",
  ];

  const proctoringBreakdown = eventTypes.map((type) => ({
    eventType: type,
    count: sessions.reduce(
      (sum, s) => sum + s.events.filter((e) => e.type === type).length,
      0,
    ),
  }));

  const trustScores = sessions.map((s) => s.trustScore);
  const avgTrustScore =
    trustScores.length > 0
      ? Math.round(trustScores.reduce((a, b) => a + b, 0) / trustScores.length)
      : 100;

  return {
    totalSessions: sessions.length,
    flaggedSessions: sessions.filter((s) => s.status === "flagged").length,
    averageTrustScore: avgTrustScore,
    totalEvents: sessions.reduce((sum, s) => sum + s.events.length, 0),
    proctoringBreakdown,
  };
}

async function generateSystemUsage(startDate, endDate) {
  const dailyStats = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayStart = new Date(currentDate);
    const dayEnd = new Date(currentDate);
    dayEnd.setDate(dayEnd.getDate() + 1);

    dailyStats.push({
      date: new Date(currentDate),
      submissions: await Submission.countDocuments({
        submittedAt: { $gte: dayStart, $lt: dayEnd },
      }),
      newUsers: await User.countDocuments({
        createdAt: { $gte: dayStart, $lt: dayEnd },
      }),
      examsCreated: await Exam.countDocuments({
        createdAt: { $gte: dayStart, $lt: dayEnd },
      }),
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return {
    totalSubmissions: await Submission.countDocuments({
      submittedAt: { $gte: startDate, $lte: endDate },
    }),
    newUsers: await User.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
    }),
    activeUsers: await Submission.distinct("studentId", {
      submittedAt: { $gte: startDate, $lte: endDate },
    }).then((ids) => ids.length),
    dailyStats,
  };
}

async function generateFlaggedSubmissions(user, startDate, endDate) {
  const query = {
    isFlagged: true,
    submittedAt: { $gte: startDate, $lte: endDate },
  };

  if (user.role === "coordinator") {
    const teacherExams = await Exam.find({ teacherId: user._id }).lean();
    query.examId = { $in: teacherExams.map((e) => e._id) };
  }

  const flaggedSubmissions = applyStudentSnapshotFallback(
    await Submission.find(query)
      .populate("studentId", "name email")
      .populate("examId", "title")
      .lean(),
  );

  return {
    totalFlagged: flaggedSubmissions.length,
    submissions: flaggedSubmissions.map((s) => ({
      submissionId: s._id,
      // Falls back to the denormalized snapshot when the roster account was deleted.
      studentName: s.studentId?.name,
      studentEmail: s.studentId?.email,
      examTitle: s.examId?.title,
      score: s.percentage,
      flagReason: s.flagReason,
      proctoringScore: s.proctoringScore,
      tabSwitches: s.tabSwitchCount,
      fullscreenExits: s.fullscreenExitCount,
    })),
  };
}

async function calculateAverageScore(examIds) {
  const submissions = await Submission.find({
    examId: { $in: examIds },
    status: { $in: ["submitted", "graded", "partially_graded"] },
  }).lean();
  if (submissions.length === 0) return 0;
  return Math.round(
    submissions.reduce((a, b) => a + b.percentage, 0) / submissions.length,
  );
}

async function calculateStudentAverageScore(studentId) {
  const submissions = await Submission.find({ studentId, status: { $in: ["submitted", "graded", "partially_graded"] } }).lean();
  if (submissions.length === 0) return 0;
  return Math.round(
    submissions.reduce((a, b) => a + b.percentage, 0) / submissions.length,
  );
}

module.exports = router;
