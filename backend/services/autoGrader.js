/**
 * Auto-grader — deterministic, offline. No external AI/SLM calls.
 *
 * MCQ / true_false / fill_blank are graded instantly via normalized exact
 * match. short_answer and essay are routed to manual coordinator review.
 */

const Submission = require("../models/Submission");
const Exam = require("../models/Exam");

const EXACT_MATCH_TYPES = ["mcq", "true_false", "fill_blank"];
const MANUAL_REVIEW_TYPES = ["short_answer", "essay"];

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Grade an mcq/true_false answer via case-insensitive trimmed exact match.
 */
function gradeMCQ(studentAnswer, correctAnswer) {
  const isCorrect =
    normalizeText(correctAnswer) === normalizeText(studentAnswer);

  return {
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    gradingStatus: "graded",
    gradingMethod: "exact_match",
  };
}

/**
 * Grade a fill_blank answer. Whitespace/case-insensitive exact match so no
 * external service is needed.
 */
function gradeFillBlank(studentAnswer, correctAnswer) {
  return gradeMCQ(studentAnswer, correctAnswer);
}

/**
 * Re-grade every answer of a submission deterministically and persist the
 * result. Exact-match types are scored instantly; text answers stay in
 * "pending_review" until a coordinator awards marks via the override API.
 *
 * Returns { totalScore, hasPendingReview }.
 */
async function regradeSubmission(submissionId) {
  const submission = await Submission.findById(submissionId);
  if (!submission) throw new Error(`Submission ${submissionId} not found`);
  const exam = await Exam.findById(submission.examId);
  if (!exam) throw new Error(`Exam ${submission.examId} not found`);

  let totalScore = 0;
  let hasPendingReview = false;

  for (const answer of submission.answers || []) {
    const question = exam.questions.id(answer.questionId);
    if (!question) continue;

    if (EXACT_MATCH_TYPES.includes(question.type)) {
      const result = gradeMCQ(answer.answer, question.correctAnswer);
      answer.isCorrect = result.isCorrect;
      answer.marksAwarded = result.isCorrect ? question.points : 0;
      answer.gradingStatus = "graded";
      answer.gradingMethod = "exact_match";
      totalScore += answer.marksAwarded;
    } else if (MANUAL_REVIEW_TYPES.includes(question.type)) {
      // Preserve marks a coordinator may already have awarded manually.
      const manualMarks =
        answer.gradingMethod === "manual_review" ||
        answer.gradingMethod === "manual"
          ? answer.marksAwarded || 0
          : 0;
      answer.gradingStatus =
        answer.gradingMethod === "manual_review" ||
        answer.gradingMethod === "manual"
          ? "graded"
          : "pending_review";
      answer.gradingMethod = "manual_review";
      answer.slmScore = null;
      answer.marksAwarded = manualMarks;
      totalScore += manualMarks;
      if (answer.gradingStatus === "pending_review") hasPendingReview = true;
    }
  }

  submission.score = totalScore;
  submission.status = hasPendingReview ? "partially_graded" : "graded";
  if (!hasPendingReview) submission.gradingCompletedAt = new Date();
  await submission.save();

  return { totalScore, hasPendingReview };
}

module.exports = {
  gradeMCQ,
  gradeFillBlank,
  EXACT_MATCH_TYPES,
  MANUAL_REVIEW_TYPES,
  regradeSubmission,
};
