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
  },
});

// Index for efficient queries
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
