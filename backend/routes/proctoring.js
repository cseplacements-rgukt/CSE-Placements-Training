const express = require("express");
const router = express.Router();
const ProctoringSession = require("../models/ProctoringSession");
const Submission = require("../models/Submission");
const User = require("../models/User");
const Exam = require("../models/Exam");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");
const { proctoringEventLimiter } = require("../middleware/rateLimiter");
const {
  snapshotFieldsFromUser,
  applyStudentSnapshotFallback,
} = require("../utils/studentSnapshot");

const EVENT_TYPES = new Set([
  "tab_switch", "tab_returned", "fullscreen_exit", "focus_lost", "focus_returned",
  "face_not_detected", "multiple_faces", "gaze_deviation", "suspicious_movement",
  "copy_paste", "right_click", "keyboard_shortcut", "dev_tools_opened",
  "webcam_disabled", "browser_resize", "audio_detected", "screenshot_attempt",
  "calibration_completed", "calibration_failed",
]);
const SEVERITIES = new Set(["low", "medium", "high"]);
const PENALTIES = { low: 2, medium: 5, high: 10 };

// Minimal ack payload for event writes — avoids echoing the whole session
// (including its capped events array) back to the client on every flush.
function pickSessionAck(session) {
  return {
    _id: session._id,
    trustScore: session.trustScore,
    status: session.status,
    eventSummary: session.eventSummary,
  };
}

function normaliseEvents(events) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 20) return null;
  const now = new Date();
  const result = [];
  for (const event of events) {
    const type = event?.type || event?.eventType;
    const severity = event?.severity || "medium";
    if (!EVENT_TYPES.has(type) || !SEVERITIES.has(severity)) return null;
    result.push({
      type,
      severity,
      details: typeof event.details === "string" ? event.details.slice(0, 500) : undefined,
      timestamp: event.clientTimestamp ? new Date(event.clientTimestamp) : now,
    });
  }
  return result;
}

async function recordEvents({ sessionId, studentId, events }) {
  const penalty = events.reduce((sum, event) => sum + PENALTIES[event.severity], 0);  const summaryIncrements = {
    "summary.totalEvents": events.length,
    "summary.highSeverityEvents": events.filter((event) => event.severity === "high").length,
    "summary.totalTabSwitches": events.filter((event) => event.type === "tab_switch").length,
    "summary.totalFullscreenExits": events.filter((event) => event.type === "fullscreen_exit").length,
    "eventSummary.tabSwitches": events.filter((event) => event.type === "tab_switch").length,
    "eventSummary.fullscreenExits": events.filter((event) => event.type === "fullscreen_exit").length,
    "eventSummary.focusLosses": events.filter((event) => event.type === "focus_lost").length,
    "eventSummary.faceMissing": events.filter((event) => event.type === "face_not_detected").length,
    "eventSummary.multipleFaces": events.filter((event) => event.type === "multiple_faces").length,
    "eventSummary.gazeDeviations": events.filter((event) => event.type === "gaze_deviation").length,
    "eventSummary.blockedInputAttempts": events.filter((event) => ["copy_paste", "right_click", "keyboard_shortcut", "dev_tools_opened"].includes(event.type)).length,
  };
  const now = new Date();
  const session = await ProctoringSession.findOneAndUpdate(
    { _id: sessionId, studentId, status: { $in: ["active", "flagged"] } },
    [
      {
        $set: {
          events: { $slice: [{ $concatArrays: ["$events", events] }, -500] },
          trustScore: { $max: [0, { $subtract: ["$trustScore", penalty] }] },
          "summary.totalEvents": { $add: ["$summary.totalEvents", summaryIncrements["summary.totalEvents"]] },
          "summary.highSeverityEvents": { $add: ["$summary.highSeverityEvents", summaryIncrements["summary.highSeverityEvents"]] },
          "summary.totalTabSwitches": { $add: ["$summary.totalTabSwitches", summaryIncrements["summary.totalTabSwitches"]] },
          "summary.totalFullscreenExits": { $add: ["$summary.totalFullscreenExits", summaryIncrements["summary.totalFullscreenExits"]] },
          "eventSummary.tabSwitches": { $add: [{ $ifNull: ["$eventSummary.tabSwitches", 0] }, summaryIncrements["eventSummary.tabSwitches"]] },
          "eventSummary.fullscreenExits": { $add: [{ $ifNull: ["$eventSummary.fullscreenExits", 0] }, summaryIncrements["eventSummary.fullscreenExits"]] },
          "eventSummary.focusLosses": { $add: [{ $ifNull: ["$eventSummary.focusLosses", 0] }, summaryIncrements["eventSummary.focusLosses"]] },
          "eventSummary.faceMissing": { $add: [{ $ifNull: ["$eventSummary.faceMissing", 0] }, summaryIncrements["eventSummary.faceMissing"]] },
          "eventSummary.multipleFaces": { $add: [{ $ifNull: ["$eventSummary.multipleFaces", 0] }, summaryIncrements["eventSummary.multipleFaces"]] },
          "eventSummary.gazeDeviations": { $add: [{ $ifNull: ["$eventSummary.gazeDeviations", 0] }, summaryIncrements["eventSummary.gazeDeviations"]] },
          "eventSummary.blockedInputAttempts": { $add: [{ $ifNull: ["$eventSummary.blockedInputAttempts", 0] }, summaryIncrements["eventSummary.blockedInputAttempts"]] },
        },
      },
      {
        $set: {
          status: { $cond: [{ $lt: ["$trustScore", 50] }, "flagged", "$status"] },
          trustScoreHistory: {
            $slice: [{ $concatArrays: ["$trustScoreHistory", [{ timestamp: now, score: "$trustScore", reason: `${events.length} proctoring event(s) recorded` }]] }, -200],
          },
        },
      },
    ],
    { new: true },
  );
  return session;
}

// Start a proctoring session
router.post("/start", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") {
      return res
        .status(403)
        .json({ message: "Only students can start proctoring sessions" });
    }

    const { examId, submissionId, deviceInfo } = req.body;

    const submission = await Submission.findOne({
      _id: submissionId,
      examId,
      studentId: user._id,
      status: "in_progress",
    }).select("_id").lean();
    if (!submission) {
      return res.status(404).json({ message: "Active submission not found" });
    }

    // Fetch exam for proctoring window settings (REQ-16)
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // REQ-16: Validate that the current time is within the proctoring window
    const proctoringSettings = exam.settings && exam.settings.proctoringWindow
      ? exam.settings.proctoringWindow
      : {};
    const preBuffer = Math.min(
      15,
      Math.max(0, proctoringSettings.preExamBufferMinutes != null ? proctoringSettings.preExamBufferMinutes : 5)
    );
    const windowStart = new Date(
      new Date(exam.scheduledAt).getTime() - preBuffer * 60 * 1000
    );
    const now = new Date();
    if (now < windowStart) {
      return res.status(403).json({
        message: `Proctoring has not started yet. It begins ${preBuffer} minute(s) before the exam at ${windowStart.toISOString()}.`,
        windowStart,
      });
    }

    // Check if session already exists
    let session = await ProctoringSession.findOne({
      studentId: user._id,
      examId,
      status: "active",
    });

    if (session) {
      return res.json({ session, message: "Existing session found" });
    }

    session = new ProctoringSession({
      submissionId,
      studentId: user._id,
      examId,
      deviceInfo,
      ...snapshotFieldsFromUser(user),
      status: "active",
    });

    // REQ-16: Compute and store the proctoring window boundaries
    session.initProctoringWindow(exam);

    await session.save();
    res.status(201).json({ session, message: "Proctoring session started" });
  } catch (error) {
    console.error("Error starting proctoring session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Log a proctoring event
router.post("/event", verifyFirebaseToken, proctoringEventLimiter, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") return res.status(403).json({ message: "Only students can log proctoring events" });

    const events = normaliseEvents([{ type: req.body.eventType, severity: req.body.severity, details: req.body.details, clientTimestamp: req.body.clientTimestamp }]);
    if (!events) return res.status(400).json({ message: "Invalid proctoring event" });
    const session = await recordEvents({ sessionId: req.body.sessionId, studentId: user._id, events });
    if (!session) return res.status(404).json({ message: "Session not found" });
    // Trimmed response: the client only needs the updated trust score. The
    // full session (with up to 500 embedded events) is NOT shipped back on
    // every event flush during a 250-student exam.
    res.json({ session: pickSessionAck(session), message: "Event logged" });
  } catch (error) {
    console.error("Error logging proctoring event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Low/medium events are coalesced by the browser and persisted in one atomic
// session update. High-value events may continue using /event immediately.
router.post("/events/batch", verifyFirebaseToken, proctoringEventLimiter, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") return res.status(403).json({ message: "Only students can log proctoring events" });
    const events = normaliseEvents(req.body.events);
    if (!events) return res.status(400).json({ message: "Provide 1 to 20 valid proctoring events" });
    const session = await recordEvents({ sessionId: req.body.sessionId, studentId: user._id, events });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json({ session: pickSessionAck(session), message: "Events logged" });
  } catch (error) {
    console.error("Error logging proctoring event batch:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// End proctoring session
router.post("/end", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { sessionId } = req.body;

    const session = await ProctoringSession.findOne({ _id: sessionId, studentId: user._id });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const now = new Date();

    // REQ-16: Compute windowEnd = submittedAt + postSubmissionBufferMinutes
    const postBuffer = session.proctoringWindow && session.proctoringWindow.postSubmissionBufferMinutes != null
      ? session.proctoringWindow.postSubmissionBufferMinutes
      : 2;
    const windowEnd = new Date(now.getTime() + postBuffer * 60 * 1000);

    session.endedAt = now;
    session.status = "ended";
    if (session.proctoringWindow) {
      session.proctoringWindow.windowEnd = windowEnd;
    } else {
      session.proctoringWindow = { windowEnd };
    }

    await session.save();

    res.json({
      session,
      message: "Proctoring session ended",
      proctoringWindow: {
        windowEnd,
        postSubmissionBufferMinutes: postBuffer,
        note: `Proctoring data retained until ${windowEnd.toISOString()} (${postBuffer} min after submission).`,
      },
    });
  } catch (error) {
    console.error("Error ending proctoring session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get active sessions (for proctors)
router.get("/active", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const sessions = applyStudentSnapshotFallback(
      await ProctoringSession.find({ status: "active" })
        .populate("studentId", "name email")
        .populate("examId", "title")
        .sort({ startedAt: -1 })
        .limit(500)
        .lean(),
    );

    res.json({ sessions });
  } catch (error) {
    console.error("Error fetching active sessions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get flagged sessions (for proctors)
router.get("/flagged", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const sessions = applyStudentSnapshotFallback(
      await ProctoringSession.find({
        $or: [{ status: "flagged" }, { reviewStatus: "pending" }],
      })
        .populate("studentId", "name email")
        .populate("examId", "title")
        .sort({ startedAt: -1 })
        .limit(500)
        .lean(),
    );

    res.json({ sessions });
  } catch (error) {
    console.error("Error fetching flagged sessions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get session details
router.get("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let session = await ProctoringSession.findById(req.params.id)
      .populate("studentId", "name email")
      .populate("examId", "title")
      .populate("reviewedBy", "name");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    session = applyStudentSnapshotFallback(session.toObject());

    // Students can only view their own sessions
    if (
      user.role === "student" &&
      session.studentId._id.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ session });
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Review session (exam-team staff)
router.put("/:id/review", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res
        .status(403)
        .json({ message: "Only exam-team staff can review sessions" });
    }

    const { reviewStatus, reviewNotes } = req.body;

    const session = await ProctoringSession.findByIdAndUpdate(
      req.params.id,
      {
        reviewStatus,
        reviewNotes,
        reviewedBy: user._id,
        reviewedAt: new Date(),
      },
      { new: true },
    ).populate("studentId", "name email");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Update submission if flagged
    if (reviewStatus === "flagged") {
      await Submission.findByIdAndUpdate(session.submissionId, {
        isFlagged: true,
        flagReason: reviewNotes,
        reviewedBy: user._id,
        reviewedAt: new Date(),
      });

      // Notify the student
      await Notification.create({
        userId: session.studentId._id,
        type: "flagged_submission",
        title: "Submission Flagged",
        message: "Your exam submission has been flagged for review.",
        data: { submissionId: session.submissionId },
        priority: "high",
      });
    }

    res.json({ session, message: "Review submitted" });
  } catch (error) {
    console.error("Error reviewing session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Camera calibration endpoint
router.post("/:id/calibrate", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") {
      return res.status(403).json({ message: "Only students can calibrate" });
    }

    const { id: sessionId } = req.params;
    const calibrationData = req.body;

    const session = await ProctoringSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Verify that the student owns this session
    if (session.studentId.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Store calibration data
    session.calibration = {
      status: calibrationData.status || "calibrated",
      timestamp: new Date(),
      duration: calibrationData.duration || 30,
      framesAnalyzed: calibrationData.framesAnalyzed || 0,
      facesDetected: calibrationData.facesDetected || 0,
      detectionRate: calibrationData.detectionRate || 0,
      thresholds: {
        minFaceDistance: calibrationData.thresholds?.minFaceDistance || 50,
        maxFaceDistance: calibrationData.thresholds?.maxFaceDistance || 150,
        minLighting: calibrationData.thresholds?.minLighting || 50,
        maxLighting: calibrationData.thresholds?.maxLighting || 200,
      },
      environment: {
        lighting: calibrationData.environment?.lighting || {},
        distance: calibrationData.environment?.distance || {},
      },
    };

    // Log calibration event
    session.events.push({
      type: "calibration_completed",
      severity: "low",
      details: `Calibration completed - Detection rate: ${calibrationData.detectionRate}%`,
      timestamp: new Date(),
    });

    await session.save();

    res.json({
      message: "Calibration data saved successfully",
      session,
    });
  } catch (error) {
    console.error("Error calibrating session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get proctoring session by submission ID (for teachers reviewing submissions)
router.get("/by-submission/:submissionId", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
      if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Fetch the MOST RECENT proctoring session for this submission
      // to avoid pulling a stale/abandoned session on retries
      const session = await ProctoringSession.findOne({
        submissionId: req.params.submissionId,
      })
        .sort({ createdAt: -1 })
        .populate("studentId", "name email")
        .populate("examId", "title");

      if (!session) {
        return res.status(404).json({ message: "No proctoring session found for this submission" });
    }

    res.json({ session: applyStudentSnapshotFallback(session.toObject()) });
  } catch (error) {
    console.error("Error fetching session by submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
