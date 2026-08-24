const mongoose = require("mongoose");

const proctoringSessionSchema = new mongoose.Schema({
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Submission",
    required: true,
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
    required: true,
  },
  // Denormalized identity snapshot (see utils/studentSnapshot.js) so the
  // session stays attributable after the roster account is deleted.
  studentName: { type: String },
  studentIdNumber: { type: String },
  batchYear: { type: Number },
  // Session info
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
  },
  // REQ-16: Proctoring Window — resolved at session init time
  proctoringWindow: {
    windowStart: {
      type: Date, // scheduledAt - preExamBufferMinutes
    },
    windowEnd: {
      type: Date, // submittedAt + postSubmissionBufferMinutes (set on session end)
    },
    preExamBufferMinutes: {
      type: Number,
      default: 5,
    },
    postSubmissionBufferMinutes: {
      type: Number,
      default: 2,
    },
  },
  status: {
    type: String,
    enum: ["active", "paused", "ended", "flagged"],
    default: "active",
  },
  // Device and browser info
  deviceInfo: {
    browser: String,
    os: String,
    screenResolution: String,
    ipAddress: String,
    userAgent: String,
  },
  // Camera calibration data
  calibration: {
    status: {
      type: String,
      enum: ["pending", "calibrated", "failed"],
      default: "pending",
    },
    timestamp: Date,
    duration: Number, // Duration in seconds (should be 30)
    framesAnalyzed: Number,
    facesDetected: Number,
    detectionRate: Number, // Percentage
    thresholds: {
      minFaceDistance: Number,
      maxFaceDistance: Number,
      minLighting: Number,
      maxLighting: Number,
    },
    environment: {
      lighting: {
        average: Number,
        min: Number,
        max: Number,
      },
      distance: {
        average: Number,
        min: Number,
        max: Number,
      },
    },
    normalizedBoundingBoxes: {
      avgX: Number,
      avgY: Number,
      avgWidth: Number,
      avgHeight: Number,
    },
  },
  // Monitoring data
  events: [
    {
      type: {
        type: String,
        enum: [
          "tab_switch",
          "fullscreen_exit",
          "face_not_detected",
          "multiple_faces",
          "audio_detected",
          "copy_paste",
          "right_click",
          "suspicious_movement",
          "browser_resize",
          "dev_tools_opened",
          "webcam_disabled",
          "focus_lost",
          "focus_returned",
          "tab_returned",
          "keyboard_shortcut",
          "screenshot_attempt",
          "calibration_completed",
          "calibration_failed",
          "gaze_deviation",
        ],
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
      severity: {
        type: String,
        enum: ["low", "medium", "high"],
        default: "medium",
      },
      details: String,
    },
  ],
  // Detection happens in the browser. The server retains only meaningful,
  // debounced events and their aggregate counters.
  faceDetectionEnabled: {
    type: Boolean,
    default: true,
  },
  // Audio monitoring
  audioMonitoringEnabled: {
    type: Boolean,
    default: false,
  },
  audioEvents: [
    {
      timestamp: Date,
      type: String, // 'speech', 'noise', 'silence'
      duration: Number,
    },
  ],
  // Trust score calculation
  trustScore: {
    type: Number,
    default: 100,
  },
  trustScoreHistory: [
    {
      timestamp: Date,
      score: Number,
      reason: String,
    },
  ],
  // Proctor notes and review
  reviewStatus: {
    type: String,
    enum: ["pending", "reviewed", "cleared", "flagged"],
    default: "pending",
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  reviewNotes: String,
  reviewedAt: Date,
  // Summary
  summary: {
    totalEvents: {
      type: Number,
      default: 0,
    },
    highSeverityEvents: {
      type: Number,
      default: 0,
    },
    averageFacesDetected: {
      type: Number,
      default: 1,
    },
    totalTabSwitches: {
      type: Number,
      default: 0,
    },
    totalFullscreenExits: {
      type: Number,
      default: 0,
    },
  },
  eventSummary: {
    tabSwitches: { type: Number, default: 0 },
    fullscreenExits: { type: Number, default: 0 },
    focusLosses: { type: Number, default: 0 },
    faceMissing: { type: Number, default: 0 },
    multipleFaces: { type: Number, default: 0 },
    gazeDeviations: { type: Number, default: 0 },
    blockedInputAttempts: { type: Number, default: 0 },
  },
});

proctoringSessionSchema.index({ studentId: 1, examId: 1 });
proctoringSessionSchema.index({ examId: 1, status: 1 });
proctoringSessionSchema.index({ status: 1, reviewStatus: 1 });

// Update summary before saving
proctoringSessionSchema.pre("save", function (next) {
  if (this.events && this.events.length > 0) {
    this.summary.totalEvents = this.events.length;
    this.summary.highSeverityEvents = this.events.filter(
      (e) => e.severity === "high",
    ).length;
    this.summary.totalTabSwitches = this.events.filter(
      (e) => e.type === "tab_switch",
    ).length;
    this.summary.totalFullscreenExits = this.events.filter(
      (e) => e.type === "fullscreen_exit",
    ).length;
  }
  next();
});

/**
 * REQ-16: initProctoringWindow
 * Computes and stores the proctoring window boundaries on session initialisation.
 *
 * @param {Object} exam - The Exam document for this session.
 *   exam.scheduledAt            {Date}   - When the exam is scheduled to start.
 *   exam.settings.proctoringWindow.preExamBufferMinutes     {Number} - Minutes before scheduledAt to start proctoring (0-15, default 5).
 *   exam.settings.proctoringWindow.postSubmissionBufferMinutes {Number} - Minutes after submission to continue proctoring (0-10, default 2).
 *
 * windowStart = scheduledAt - preExamBufferMinutes
 * windowEnd   = set later (on session end) = submittedAt + postSubmissionBufferMinutes
 */
proctoringSessionSchema.methods.initProctoringWindow = function (exam) {
  const settings = exam.settings && exam.settings.proctoringWindow
    ? exam.settings.proctoringWindow
    : {};

  // Apply defaults and clamp to allowed range (min/max are enforced by Exam schema,
  // but we re-clamp here as a defence in depth measure)
  const preBuffer = Math.min(
    15,
    Math.max(0, settings.preExamBufferMinutes != null ? settings.preExamBufferMinutes : 5)
  );
  const postBuffer = Math.min(
    10,
    Math.max(0, settings.postSubmissionBufferMinutes != null ? settings.postSubmissionBufferMinutes : 2)
  );

  const windowStart = new Date(
    new Date(exam.scheduledAt).getTime() - preBuffer * 60 * 1000
  );

  this.proctoringWindow = {
    windowStart,
    windowEnd: null, // Will be set when the session ends
    preExamBufferMinutes: preBuffer,
    postSubmissionBufferMinutes: postBuffer,
  };
};

module.exports = mongoose.model("ProctoringSession", proctoringSessionSchema);
