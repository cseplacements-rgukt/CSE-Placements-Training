const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  answer: {
    type: String,
    default: "",
  },
  isCorrect: {
    type: Boolean,
    default: false,
  },
  slmScore: {
    type: Number,
    default: null, // Raw SLM similarity score ∈ [0.0, 1.0]
  },
  marksAwarded: {
    type: Number,
    default: 0,
  },
  gradingStatus: {
    type: String,
    enum: ["ungraded", "graded", "pending_review", "error"],
    default: "ungraded",
  },
  gradingMethod: {
    type: String,
    enum: ["exact_match", "slm_semantic", "manual", "manual_review"],
    default: "exact_match",
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const proctoringEventSchema = new mongoose.Schema({
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
      "focus_lost",
      "focus_returned",
      "tab_returned",
      "webcam_disabled",
    ],
    required: true,
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
  details: {
    type: String,
  },
});

const submissionSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
    required: true,
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  // Denormalized identity snapshot (see utils/studentSnapshot.js): lets
  // reports show who took the exam even after the roster account is deleted.
  studentName: { type: String },
  studentIdNumber: { type: String },
  batchYear: { type: Number },
  answers: [answerSchema],
  score: {
    type: Number,
    default: 0,
  },
  maxScore: {
    type: Number,
    default: 0,
  },
  percentage: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ["in_progress", "submitted", "grading", "graded", "partially_graded", "flagged", "locked"],
    default: "in_progress",
  },
  gradingCompletedAt: {
    type: Date,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  submittedAt: {
    type: Date,
  },
  // Proctoring data
  tabSwitchCount: {
    type: Number,
    default: 0,
  },
  fullscreenExitCount: {
    type: Number,
    default: 0,
  },
  proctoringEvents: [proctoringEventSchema],
  proctoringScore: {
    type: Number,
    default: 100, // Trust score starts at 100
  },
  // Auto-save tracking
  lastAutoSave: {
    type: Date,
  },
  autoSaveCount: {
    type: Number,
    default: 0,
  },
  // Review by proctor
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  reviewedAt: {
    type: Date,
  },
  reviewNotes: {
    type: String,
  },
  isFlagged: {
    type: Boolean,
    default: false,
  },
  flagReason: {
    type: String,
  },
  // Auto-lock info
  lockInfo: {
    lockedAt: {
      type: Date,
    },
    lockReason: {
      type: String,
    },
    lockedBySystem: {
      type: Boolean,
      default: false,
    },
    unlockedAt: {
      type: Date,
    },
    unlockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
});

submissionSchema.index({ studentId: 1, examId: 1 });
submissionSchema.index({ examId: 1, status: 1 });

// Calculate percentage before saving
submissionSchema.pre("save", function (next) {
  if (this.maxScore > 0) {
    this.percentage = Math.round((this.score / this.maxScore) * 100);
  } else {
    this.percentage = 0;
  }
  // Guard against NaN
  if (isNaN(this.percentage)) {
    this.percentage = 0;
  }
  if (isNaN(this.score)) {
    this.score = 0;
  }
  next();
});

module.exports = mongoose.model("Submission", submissionSchema);
