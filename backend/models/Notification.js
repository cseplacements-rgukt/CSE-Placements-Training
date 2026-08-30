const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: [
      "exam_scheduled",
      "exam_reminder",
      "exam_started",
      "exam_ending_soon",
      "exam_submitted",
      "exam_graded",
      "proctoring_alert",
      "account_update",
      "system_announcement",
      "flagged_submission",
      "exam_locked",
    ],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  data: {
    examId: mongoose.Schema.Types.ObjectId,
    submissionId: mongoose.Schema.Types.ObjectId,
    link: String,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  priority: {
    type: String,
    enum: ["low", "medium", "high", "urgent"],
    default: "medium",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  readAt: {
    type: Date,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
});

// Auto-expire: transient exam notifications disappear after 14 days, urgent kept 30.
// If expiresAt is not set explicitly, set a default based on priority.
notificationSchema.pre("save", function (next) {
  if (!this.expiresAt) {
    const base = this.createdAt || new Date();
    const days = this.priority === "high" || this.priority === "urgent" ? 30 : 14;
    this.expiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }
  next();
});

// Index for efficient queries
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
// TTL — Mongo deletes the doc when expiresAt passes
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Notification", notificationSchema);
