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

/**
 * Bulk fix the correct answer for one question and regrade ALL submissions.
 * Updates exam.questions[].correctAnswer and recomputes score/percentage/status
 * for every non-in-progress submission. Also refreshes exam percentageSum/averageScore.
 *
 * Returns { affected, totalSubmissions }.
 */
async function fixAnswerKeyAndRegrade(examId, questionId, newCorrectAnswer) {
  const exam = await Exam.findById(examId);
  if (!exam) throw new Error(`Exam ${examId} not found`);
  const question = exam.questions.id(questionId);
  if (!question) throw new Error(`Question ${questionId} not found in exam`);

  // Persist new answer key
  question.correctAnswer = String(newCorrectAnswer).trim();
  // Keep modelAnswer in sync if it was mirroring the old key (optional)
  exam.updatedAt = new Date();
  await exam.save();

  const points = question.points || 1;
  const submissions = await Submission.find({ examId });

  let affected = 0;
  for (const sub of submissions) {
    // In-progress attempts will be graded at submit time with the new key; skip.
    if (["in_progress", "processing_submission"].includes(sub.status)) continue;
    const ans = (sub.answers || []).find((a) => String(a.questionId) === String(questionId));
    if (!ans) continue;

    const isCorrect = normalizeText(ans.answer) === normalizeText(newCorrectAnswer);
    const newMarks = isCorrect ? points : 0;

    // Always overwrite to enforce the new key for everyone (including prior manual overrides)
    const needsUpdate =
      ans.isCorrect !== isCorrect ||
      ans.marksAwarded !== newMarks ||
      ans.gradingStatus !== "graded" ||
      ans.gradingMethod !== "exact_match";

    if (!needsUpdate) continue;

    ans.isCorrect = isCorrect;
    ans.marksAwarded = newMarks;
    ans.gradingStatus = "graded";
    ans.gradingMethod = "exact_match";
    ans.updatedAt = new Date();

    // Recalc total
    let total = 0;
    for (const a of sub.answers) total += a.marksAwarded || 0;
    sub.score = total;
    if (sub.maxScore > 0) sub.percentage = Math.round((total / sub.maxScore) * 100);
    else sub.percentage = 0;

    const hasPending = (sub.answers || []).some(
      (a) => a.gradingStatus === "pending_review" || a.gradingStatus === "ungraded"
    );
    if (hasPending) {
      sub.status = "partially_graded";
      sub.gradingCompletedAt = undefined;
    } else {
      sub.status = "graded";
      sub.gradingCompletedAt = new Date();
    }
    await sub.save();
    affected++;
  }

  // Refresh exam aggregates
  const scored = await Submission.find({
    examId,
    status: { $in: ["submitted", "grading", "graded", "partially_graded", "locked"] },
  })
    .select("percentage")
    .lean();
  if (scored.length > 0) {
    const sum = scored.reduce((s, a) => s + (isNaN(a.percentage) ? 0 : a.percentage), 0);
    const avg = Math.round(sum / scored.length);
    await Exam.findByIdAndUpdate(examId, {
      percentageSum: sum,
      averageScore: avg,
      totalSubmissions: scored.length,
    });
  } else {
    await Exam.findByIdAndUpdate(examId, { percentageSum: 0, averageScore: 0 });
  }

  return { affected, totalSubmissions: submissions.length };
}

module.exports = {
  gradeMCQ,
  gradeFillBlank,
  EXACT_MATCH_TYPES,
  MANUAL_REVIEW_TYPES,
  regradeSubmission,
  fixAnswerKeyAndRegrade,
};
