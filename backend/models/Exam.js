const mongoose = require("mongoose");
const crypto = require("crypto");

// 30-char alphabet: excludes 0/O, 1/I/L to prevent confusion when read aloud
const EXAM_CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const EXAM_CODE_LENGTH = 6;

function generateExamCode() {
  const bytes = crypto.randomBytes(EXAM_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < EXAM_CODE_LENGTH; i++) {
    code += EXAM_CODE_CHARS[bytes[i] % EXAM_CODE_CHARS.length];
  }
  return code;
}

// States in which the training team is still building the exam.
const EDITABLE_STATUSES = ["draft", "ready_for_review"];
// States that require full scheduling information (students can attempt these).
const LIVE_STATUSES = ["published", "closed", "archived"];

const questionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["mcq", "short_answer", "fill_blank", "true_false", "essay"],
    required: true,
  },
  question: {
    type: String,
    required: true,
  },
  // Rich content support. `question` always carries the text body and may
  // embed KaTeX math ($...$ / $$...$$) and ``` fenced code blocks. When
  // contentType === "code" the primary payload lives in codeSnippet.code.
  contentType: {
    type: String,
    enum: ["text", "code"],
    default: "text",
  },
  codeSnippet: {
    code: {
      type: String,
      default: "",
    },
    language: {
      type: String,
      default: "plaintext",
    },
  },
  options: [
    {
      type: String,
    },
  ], // For MCQ and true_false
  correctAnswer: {
    type: String,
    required: true,
  },
  modelAnswer: {
    type: String,
    default: "", // Used by SLM grading engine; falls back to correctAnswer if empty
  },
  points: {
    type: Number,
    default: 1,
  },
  explanation: {
    type: String, // Optional explanation for the answer
  },
  order: {
    type: Number,
    default: 0,
  },
  imageUrl: {
    type: String,
    default: "",
  },
  questionBankId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    default: null,
  },
  // Optional section this question belongs to. Sections are lightweight
  // metadata on the exam; null/absent means the flat ungrouped pool.
  sectionId: {
    type: mongoose.Schema.Types.ObjectId, // References exam.sections._id
    default: null,
  },
  // Author of this question snapshot — used by the consolidated review view.
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  createdByName: {
    type: String,
    default: "",
  },
  // Question constraints
  constraints: {
    wordLimit: {
      type: Number,
      default: null, // No limit if null (applicable for essay, short_answer)
    },
    difficultyLevel: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
  },
});

// Optional named sections ("Speed and Time", or difficulty buckets like
// "Easy"/"Medium"). Purely organizational — exams work fine with zero sections
// and every question in the flat pool.
const sectionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  ownerIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Collaborative authoring: creator + contributors, all coordinator-tier staff.
// teacherId remains the canonical creator for backward compatibility;
// contributors gain edit access to the draft without owning it.
const collaboratorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  role: {
    type: String,
    enum: ["creator", "contributor"],
    default: "contributor",
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

const examSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  // No longer mandatory at creation — internal drafts identify themselves by
  // title/round alone. Defaults to a generic bucket for student-facing views.
  targetCompany: {
    type: String,
    default: "General",
  },
  examCategory: {
    type: String,
    enum: ["Aptitude", "Technical", "Coding", "Mixed"],
    default: "Aptitude",
  },
  instructions: {
    type: String,
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  collaborators: [collaboratorSchema],
  sections: [sectionSchema],
  questions: [questionSchema],
  // Timing is optional while the exam is a draft/ready_for_review shell and is
  // enforced at publish time (see routes/exams.js publish validation).
  scheduledAt: {
    type: Date,
    default: null,
  },
  duration: {
    type: Number, // Duration in minutes
    min: 1,
    default: null,
  },
  endTime: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: false, // Legacy compatibility, will be derived from status
  },
  status: {
    type: String,
    enum: ["draft", "ready_for_review", "published", "closed", "archived"],
    default: "draft",
  },
  // Marker for when the creator compiled/submitted the draft for review.
  submittedForReviewAt: {
    type: Date,
    default: null,
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  // Exam settings
  settings: {
    shuffleQuestions: {
      type: Boolean,
      default: false,
    },
    shuffleOptions: {
      type: Boolean,
      default: false,
    },
    showResultsImmediately: {
      type: Boolean,
      default: true,
    },
    allowBackNavigation: {
      type: Boolean,
      default: true,
    },
    requireWebcam: {
      type: Boolean,
      default: true,
    },
    requireFullscreen: {
      type: Boolean,
      default: true,
    },
    // On-screen scientific calculator for students during this exam.
    // Purely client-side — the backend only stores/serves the flag.
    enableCalculator: {
      type: Boolean,
      default: false,
    },
    maxAttempts: {
      type: Number,
      default: 1,
    },
    passingScore: {
      type: Number,
      default: 50, // Percentage
    },
    autoSubmitOnTimeUp: {
      type: Boolean,
      default: true,
    },
    // Minimum time a student must spend before the Submit button unlocks
    // (server-enforced on POST /api/submissions). 0 = no floor. Auto-submit
    // at time-up is never blocked because this must stay < duration.
    minDurationMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    enableNegativeMarking: {
      type: Boolean,
      default: false, // Teacher-configurable; no negative marking by default
    },
    // REQ-16: Proctoring Window — configurable per exam by teacher
    proctoringWindow: {
      preExamBufferMinutes: {
        type: Number,
        default: 5,
        min: 0,
        max: 15,
      },
      postSubmissionBufferMinutes: {
        type: Number,
        default: 2,
        min: 0,
        max: 10,
      },
    },
  },
  // Access control
  allowedStudents: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  isPublic: {
    type: Boolean,
    default: true,
  },
  examCode: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple docs with null (drafts)
    index: true,
  },
  // Statistics — maintained incrementally/atomically (never recomputed by
  // scanning submissions during an exam window).
  // percentageSum = running sum of submission percentages; averageScore is
  // derived as round(percentageSum / max(totalSubmissions, 1)). Legacy exams
  // without percentageSum seed it lazily from their stored average.
  totalSubmissions: {
    type: Number,
    default: 0,
  },
  percentageSum: {
    type: Number,
    default: 0,
  },
  averageScore: {
    type: Number,
    default: 0,
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

// Calculate total points
examSchema.virtual("totalPoints").get(function () {
  if (!this.questions) return 0;
  return this.questions.reduce((sum, q) => sum + q.points, 0);
});

// Backfill: legacy exams only carry the single-owner `teacherId`. Make the
// creator an explicit collaborator so access checks can rely on the array.
examSchema.pre("validate", function (next) {
  if (
    this.teacherId &&
    (!this.collaborators || this.collaborators.length === 0)
  ) {
    this.collaborators = [
      { userId: this.teacherId, role: "creator", addedAt: new Date() },
    ];
  }
  next();
});

// Published/closed/archived exams are student-facing — timing must exist.
examSchema.pre("validate", function (next) {
  if (LIVE_STATUSES.includes(this.status)) {
    if (!this.scheduledAt || !this.duration || !this.endTime) {
      return next(
        new Error("Scheduled time, duration, and end time are required once an exam is published.")
      );
    }
  }
  // The minimum-time floor must always be reachable inside the exam window;
  // otherwise students could be locked out of submitting entirely.
  const minMin = this.settings?.minDurationMinutes;
  if (minMin && this.duration && minMin >= this.duration) {
    return next(
      new Error("Minimum time before submit must be less than the exam duration.")
    );
  }
  next();
});

// Update timestamp on save
examSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

examSchema.index({ teacherId: 1, scheduledAt: 1 });
examSchema.index({ examCode: 1 });
// Team draft listings: find drafts a user collaborates on efficiently.
examSchema.index({ "collaborators.userId": 1, updatedAt: -1 });

// Include virtuals in JSON
examSchema.set("toJSON", { virtuals: true });
examSchema.set("toObject", { virtuals: true });

const Exam = mongoose.model("Exam", examSchema);

module.exports = Exam;
module.exports.generateExamCode = generateExamCode;
module.exports.EDITABLE_STATUSES = EDITABLE_STATUSES;
module.exports.LIVE_STATUSES = LIVE_STATUSES;
