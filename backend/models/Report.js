const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      "exam_analytics",
      "student_performance",
      "proctoring_summary",
      "system_usage",
      "flagged_submissions",
      "teacher_activity",
    ],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  // Time range for the report
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  // Report data
  data: {
    totalExams: Number,
    totalSubmissions: Number,
    averageScore: Number,
    passRate: Number,
    flaggedSubmissions: Number,
    totalStudents: Number,
    totalTeachers: Number,
    activeUsers: Number,
    // Proctoring stats
    totalProctoringEvents: Number,
    averageTrustScore: Number,
    // Detailed breakdown
    examBreakdown: [
      {
        examId: mongoose.Schema.Types.ObjectId,
        title: String,
        submissions: Number,
        averageScore: Number,
        passRate: Number,
      },
    ],
    studentBreakdown: [
      {
        studentId: mongoose.Schema.Types.ObjectId,
        name: String,
        examsAttempted: Number,
        averageScore: Number,
        flaggedCount: Number,
      },
    ],
    proctoringBreakdown: [
      {
        eventType: String,
        count: Number,
      },
    ],
    dailyStats: [
      {
        date: Date,
        submissions: Number,
        newUsers: Number,
        examsCreated: Number,
      },
    ],
  },
  // Export options
  format: {
    type: String,
    enum: ["json", "csv", "pdf"],
    default: "json",
  },
  fileUrl: {
    type: String, // URL to exported file if generated
  },
  status: {
    type: String,
    enum: ["pending", "generated", "failed"],
    default: "generated",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Report", reportSchema);
