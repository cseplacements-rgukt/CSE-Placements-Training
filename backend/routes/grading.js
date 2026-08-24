/**
 * Grading Routes — Status, Override, Regrade
 *
 * Provides API endpoints for checking grading status,
 * manual score overrides by teachers, and re-running deterministic grading.
 */

const express = require("express");
const router = express.Router();
const Submission = require("../models/Submission");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");
const { regradeSubmission } = require("../services/autoGrader");

/**
 * GET /api/grading/:submissionId/status
 * Check the grading status of a submission (polling endpoint).
 */
router.get("/:submissionId/status", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const submission = await Submission.findById(req.params.submissionId)
      .populate("examId", "title questions");

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Access control: student sees own, teacher sees own exams
    if (
      user.role === "student" &&
      submission.studentId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (
      user.role === "coordinator" &&
      submission.examId.teacherId &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Build per-answer status summary
    const answerStatuses = submission.answers.map((a) => ({
      questionId: a.questionId,
      gradingStatus: a.gradingStatus,
      gradingMethod: a.gradingMethod,
      marksAwarded: a.marksAwarded,
      slmScore: a.slmScore,
    }));

    const pendingCount = submission.answers.filter(
      (a) => a.gradingStatus === "pending_review" || a.gradingStatus === "ungraded"
    ).length;

    const gradedCount = submission.answers.filter(
      (a) => a.gradingStatus === "graded"
    ).length;

    res.json({
      submissionId: submission._id,
      status: submission.status,
      score: submission.score,
      maxScore: submission.maxScore,
      percentage: submission.percentage,
      gradingCompletedAt: submission.gradingCompletedAt,
      totalAnswers: submission.answers.length,
      gradedCount,
      pendingCount,
      answerStatuses,
    });
  } catch (error) {
    console.error("Error getting grading status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * PUT /api/grading/:submissionId/override
 * Teacher manually overrides score for specific answers.
 *
 * Body: { overrides: [{ questionId, marksAwarded, reason }] }
 */
router.put("/:submissionId/override", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { overrides } = req.body;
    if (!overrides || !Array.isArray(overrides) || overrides.length === 0) {
      return res.status(400).json({ message: "overrides array is required" });
    }

    const submission = await Submission.findById(req.params.submissionId)
      .populate("examId");

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Teacher can only override scores for their own exam
    if (
      user.role === "coordinator" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Validate and apply overrides
    const errors = [];
    for (const override of overrides) {
      if (!override.questionId) {
        errors.push("Missing questionId in override");
        continue;
      }

      const answer = submission.answers.find(
        (a) => a.questionId.toString() === override.questionId
      );

      if (!answer) {
        errors.push(`Answer not found for question ${override.questionId}`);
        continue;
      }

      // Find the question to validate against max points
      const question = submission.examId.questions.id(override.questionId);
      const maxPoints = question ? question.points : Infinity;

      const marks = parseFloat(override.marksAwarded);
      if (isNaN(marks) || marks < 0) {
        errors.push(`Invalid marks for question ${override.questionId}: must be >= 0`);
        continue;
      }
      if (marks > maxPoints) {
        errors.push(`Marks (${marks}) exceed maximum (${maxPoints}) for question ${override.questionId}`);
        continue;
      }

      // Apply override
      answer.marksAwarded = marks;
      answer.gradingStatus = "graded";
      answer.gradingMethod = "manual";
      answer.isCorrect = marks > 0;
      answer.updatedAt = new Date();
    }

    if (errors.length > 0 && errors.length === overrides.length) {
      // All overrides failed
      return res.status(400).json({ message: "All overrides failed", errors });
    }

    // Recalculate total score from all answers
    let totalScore = 0;
    for (const answer of submission.answers) {
      totalScore += answer.marksAwarded || 0;
    }

    submission.score = totalScore;
    submission.reviewedBy = user._id;
    submission.reviewedAt = new Date();

    // Check if all answers are now graded
    const allGraded = submission.answers.every(
      (a) => a.gradingStatus === "graded"
    );

    if (allGraded) {
      submission.status = "graded";
      submission.gradingCompletedAt = new Date();
    }

    await submission.save();

    // Notify student
    await Notification.create({
      userId: submission.studentId,
      type: "exam_graded",
      title: "Score Updated",
      message: `Your score for "${submission.examId.title}" has been manually reviewed by your teacher`,
      data: { submissionId: submission._id, examId: submission.examId._id },
      priority: "medium",
    });

    res.json({
      submission,
      message: errors.length > 0
        ? `Overrides applied with ${errors.length} warning(s)`
        : "Scores overridden successfully",
      warnings: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error overriding scores:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * PUT /api/grading/:submissionId/override-total
 * Teacher directly overrides the total score for a submission.
 *
 * Body: { score, reason }
 */
router.put("/:submissionId/override-total", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { score, reason } = req.body;

    if (score === undefined || score === null) {
      return res.status(400).json({ message: "score is required" });
    }

    const numScore = parseFloat(score);
    if (isNaN(numScore) || numScore < 0) {
      return res.status(400).json({ message: "score must be a non-negative number" });
    }

    const submission = await Submission.findById(req.params.submissionId)
      .populate("examId");

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Teacher can only override scores for their own exam
    if (
      user.role === "coordinator" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (numScore > submission.maxScore) {
      return res.status(400).json({
        message: `Score (${numScore}) exceeds maximum (${submission.maxScore})`,
      });
    }

    submission.score = numScore;
    submission.reviewedBy = user._id;
    submission.reviewedAt = new Date();
    if (reason) {
      submission.reviewNotes = (submission.reviewNotes || "") +
        `\n[Override ${new Date().toLocaleDateString()}]: Total score set to ${numScore}/${submission.maxScore}. Reason: ${reason}`;
    }

    // Mark as graded since teacher has manually set the score
    if (submission.status !== "locked") {
      submission.status = "graded";
      submission.gradingCompletedAt = new Date();
    }

    await submission.save();

    // Notify student
    await Notification.create({
      userId: submission.studentId,
      type: "exam_graded",
      title: "Score Updated",
      message: `Your total score for "${submission.examId.title}" has been updated by your teacher`,
      data: { submissionId: submission._id, examId: submission.examId._id },
      priority: "medium",
    });

    res.json({
      submission,
      message: "Total score overridden successfully",
    });
  } catch (error) {
    console.error("Error overriding total score:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * POST /api/grading/:submissionId/regrade
 * Re-run deterministic grading (exact-match parts rescored; text answers
 * stay pending coordinator review).
 */
router.post("/:submissionId/regrade", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const submission = await Submission.findById(req.params.submissionId)
      .populate("examId");

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Teacher can only regrade their own exam submissions
    if (
      user.role === "coordinator" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Deterministic re-grade, persisted inside the helper.
    const result = await regradeSubmission(submission._id.toString());

    const updated = await Submission.findById(submission._id);
    res.json({
      message: result.hasPendingReview
        ? "Re-graded — text answers still pending coordinator review"
        : "Re-grading complete",
      async: false,
      hasPendingReview: result.hasPendingReview,
      submission: updated,
    });
  } catch (error) {
    console.error("Error re-grading:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
