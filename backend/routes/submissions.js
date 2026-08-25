const express = require("express");
const router = express.Router();
const Submission = require("../models/Submission");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");
const { submissionLimiter, autoSaveLimiter } = require("../middleware/rateLimiter");
const { gradeMCQ, EXACT_MATCH_TYPES, MANUAL_REVIEW_TYPES } = require("../services/autoGrader");

const { snapshotFieldsFromUser, applyStudentSnapshotFallback } = require("../utils/studentSnapshot");
const {
  resolveRosterStudent,
  rosterStudentIdFromToken,
} = require("../utils/rosterIdentity");

// ── Result release gating ───────────────────────────────────────────────────
// Students never see scores before the WHOLE exam window closes: results are
// released only after `endTime` + a 5-minute buffer (covers late auto-
// submits and clock drift). Until then every student-facing view strips
// scores/answer marks and flags the submission as `resultsPending`.
const RESULTS_RELEASE_BUFFER_MS = 5 * 60 * 1000;

function examResultsReleaseAt(exam) {
  if (!exam) return null;
  const end = exam.endTime
    ? new Date(exam.endTime)
    : exam.scheduledAt && exam.duration
      ? new Date(new Date(exam.scheduledAt).getTime() + exam.duration * 60000)
      : null;
  return end
    ? new Date(end.getTime() + RESULTS_RELEASE_BUFFER_MS)
    : null;
}

function resultsReleasedFor(exam, at = new Date()) {
  const releaseAt = examResultsReleaseAt(exam);
  // No timing info (shouldn't happen for published exams) → don't gate.
  return !releaseAt || releaseAt.getTime() <= at.getTime();
}

// Mutates a student-facing submission object: hides all score data until
// release time and stamps when results become visible.
function gateResultsForStudent(submissionObj, exam) {
  if (resultsReleasedFor(exam)) return submissionObj;
  const releaseAt = examResultsReleaseAt(exam);
  submissionObj.resultsPending = true;
  submissionObj.resultsReleaseAt = releaseAt ? releaseAt.toISOString() : null;
  submissionObj.score = 0;
  submissionObj.percentage = 0;
  submissionObj.maxScore = submissionObj.maxScore ?? 0;
  submissionObj.answers = submissionObj.answers?.map((a) => ({
    ...a,
    isCorrect: undefined,
    marksAwarded: undefined,
    slmScore: undefined,
  }));
  if (submissionObj.examId && typeof submissionObj.examId === "object") {
    submissionObj.examId.questions = submissionObj.examId.questions?.map((q) => ({
      ...q,
      correctAnswer: undefined,
      modelAnswer: undefined,
      explanation: undefined,
    }));
  }
  return submissionObj;
}

// ── Deterministic per-submission shuffle ────────────────────────────────────
// Seeded Fisher-Yates: the same submission always gets the SAME order (page
// reloads stay consistent) while different students get different orders.
function seededShuffle(items, seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const rand = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Sanitize questions for a student and apply exam-settings shuffling.
function prepareExamForStudent(exam, submission) {
  const data = exam.toObject();
  let questions = data.questions.map((q) => {
    const { correctAnswer, modelAnswer, ...safeQ } = q;
    return safeQ;
  });

  if (data.settings?.shuffleQuestions && questions.length > 1) {
    questions = seededShuffle(questions, String(submission._id));
  }
  if (data.settings?.shuffleOptions) {
    questions = questions.map((q) =>
      Array.isArray(q.options) && q.options.length > 1
        ? { ...q, options: seededShuffle(q.options, `${submission._id}:${q._id}`) }
        : q
    );
  }

  data.questions = questions;
  return data;
}

// Start an exam (creates in-progress submission)

router.post("/start", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await resolveRosterStudent(req);
    if (!user) {
      return res.status(403).json({ message: "Only students can start exams" });
    }

    const { examId, examCode } = req.body;
    const exam = await Exam.findById(examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // Check if exam is active
    const now = new Date();
    if (now < exam.scheduledAt) {
      return res.status(400).json({ message: "Exam has not started yet" });
    }
    if (now > exam.endTime) {
      return res.status(400).json({ message: "Exam time has ended" });
    }

    // Check for existing submission
    let submission = await Submission.findOne({
      examId,
      studentId: user._id,
    });

    if (submission) {
      // Crash/restart recovery: a submission can be stranded in
      // processing_submission if the process died mid-submit. After 10 minutes
      // it is safe to let the student back in rather than bricking the attempt.
      if (submission.status === "processing_submission") {
        const stuckForMs = Date.now() - new Date(submission.submittedAt || submission.startedAt).getTime();
        if (stuckForMs > 10 * 60 * 1000) {
          await Submission.updateOne(
            { _id: submission._id, status: "processing_submission" },
            { $set: { status: "in_progress", submittedAt: null } }
          );
          submission.status = "in_progress";
          submission.submittedAt = null;
        } else {
          return res.status(400).json({ message: "Your submission is being processed. Please refresh in a minute." });
        }
      }
      if (submission.status !== "in_progress") {
        return res
          .status(400)
          .json({ message: "You have already submitted this exam" });
      }
      // Return existing in-progress submission (same shuffle order as before)
      const examData = prepareExamForStudent(exam, submission);
      return res.json({ submission, exam: examData, message: "Resuming exam" });
    }

    // New submission being created. Enforce exam code!
    const normalizedReceivedCode = String(examCode || "").trim().toUpperCase();
    const normalizedStoredCode = String(exam.examCode || "").trim().toUpperCase();

    if (!normalizedReceivedCode || normalizedReceivedCode !== normalizedStoredCode) {
      return res.status(403).json({ message: "Valid exam code is required to start the exam." });
    }

    // Calculate max score
    const maxScore = exam.questions.reduce((sum, q) => sum + q.points, 0);

    // Create new submission
    submission = new Submission({
      examId,
      studentId: user._id,
      ...snapshotFieldsFromUser(user),
      status: "in_progress",
      maxScore,
      startedAt: new Date(),
      answers: exam.questions.map((q) => ({
        questionId: q._id,
        answer: "",
      })),
    });

    await submission.save();
    // Return submission AND exam (shuffled per this submission when enabled)
    const examData = prepareExamForStudent(exam, submission);
    res.status(201).json({ submission, exam: examData, message: "Exam started" });
  } catch (error) {
    console.error("Error starting exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Auto-save answers
router.post("/auto-save", verifyFirebaseToken, autoSaveLimiter, async (req, res) => {
  try {
    // Hottest endpoint during an exam (every student, every 30 s). The
    // student id comes from the signed token — no Mongo identity lookup.
    if (req.user?.authType !== "student-roster" || !req.user.studentId) {
      return res
        .status(403)
        .json({ message: "Only students can save answers" });
    }
    const user = { _id: req.user.studentId };

    const { submissionId, changes, answers } = req.body;
    // `answers` is accepted temporarily for clients deployed before delta saves.
    const requestedChanges = Array.isArray(changes) ? changes : answers;
    if (!submissionId || !Array.isArray(requestedChanges) || requestedChanges.length > 100) {
      return res.status(400).json({ message: "A changes array of at most 100 answers is required" });
    }

    const deduplicated = new Map();
    for (const change of requestedChanges) {
      if (!change?.questionId || !/^[a-f\d]{24}$/i.test(String(change.questionId)) || typeof change.answer !== "string" || change.answer.length > 100000) {
        return res.status(400).json({ message: "Each answer change must contain a valid questionId and answer" });
      }
      deduplicated.set(String(change.questionId), change.answer);
    }

    const now = new Date();
    const ids = [...deduplicated.keys()];
    const set = { lastAutoSave: now };
    for (const [questionId, answer] of deduplicated) {
      set[`answers.$[answer_${questionId}].answer`] = answer;
      set[`answers.$[answer_${questionId}].updatedAt`] = now;
    }
    const result = await Submission.updateOne(
      { _id: submissionId, studentId: user._id, status: "in_progress", "answers.questionId": { $all: ids } },
      { $set: set, $inc: { autoSaveCount: 1 } },
      { arrayFilters: ids.map((id) => ({ [`answer_${id}.questionId`]: id })) },
    );
    if (!result.matchedCount) {
      return res.status(404).json({ message: "Submission not found or already submitted" });
    }
    res.json({ message: "Auto-saved", lastAutoSave: now, savedQuestionIds: ids });
  } catch (error) {
    console.error("Error auto-saving:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Submit an exam (Student only)
router.post("/", verifyFirebaseToken, submissionLimiter, async (req, res) => {
  try {
    const user = await resolveRosterStudent(req);

    if (!user) {
      return res
        .status(403)
        .json({ message: "Only students can submit exams" });
    }

    const {
      examId,
      answers,
      tabSwitchCount,
      fullscreenExitCount,
      submissionId,
    } = req.body;

    const exam = await Exam.findById(examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // Check if exam time has ended (with grace period of 5 minutes)
    const now = new Date();
    const graceEndTime = new Date(exam.endTime.getTime() + 5 * 60 * 1000);
    if (now > graceEndTime) {
      return res
        .status(400)
        .json({ message: "Exam submission time has ended" });
    }

    // ── Minimum-time floor (server authoritative) ────────────
    // If the exam defines settings.minDurationMinutes, a student cannot submit
    // before spending that long on THEIR OWN attempt. Checked BEFORE the
    // processing lock so an early attempt costs one indexed read and never
    // strands the submission in a locked state. Auto-submit at time-up is not
    // affected: min < duration is enforced by the Exam schema.
    const minMinutes = Number(exam.settings?.minDurationMinutes) || 0;
    if (minMinutes > 0) {
      const probe = submissionId
        ? await Submission.findById(submissionId)
            .select("startedAt")
            .lean()
        : await Submission.findOne({ examId, studentId: user._id })
            .sort({ startedAt: -1 })
            .select("startedAt")
            .lean();
      if (!probe?.startedAt) {
        return res.status(400).json({
          code: "MIN_TIME_NOT_REACHED",
          message: "Start the exam first — there is no active attempt to submit.",
        });
      }
      const canSubmitAt = new Date(probe.startedAt.getTime() + minMinutes * 60000);
      if (now < canSubmitAt) {
        return res.status(400).json({
          code: "MIN_TIME_NOT_REACHED",
          message: `You need to spend at least ${minMinutes} minute${minMinutes === 1 ? "" : "s"} on this exam before submitting.`,
          canSubmitAt: canSubmitAt.toISOString(),
          remainingSeconds: Math.max(0, Math.ceil((canSubmitAt - now) / 1000)),
        });
      }
    }

    // Find or create submission and atomically lock it for processing
    let submission;
    if (submissionId) {
      submission = await Submission.findOneAndUpdate(
        { _id: submissionId, studentId: user._id, status: "in_progress" },
        { status: "processing_submission", submittedAt: new Date() },
        { new: true }
      );
      if (!submission) {
        // Either it doesn't exist, or it's no longer in_progress (already submitted)
        return res.status(400).json({ message: "Submission not found or already submitted" });
      }
    } else {
      // Find existing in_progress submission and lock it
      submission = await Submission.findOneAndUpdate(
        { examId, studentId: user._id, status: "in_progress" },
        { status: "processing_submission", submittedAt: new Date() },
        { new: true }
      );
      
      if (!submission) {
        // Check if they already submitted it entirely
        const existing = await Submission.findOne({ examId, studentId: user._id });
        if (existing) {
          return res.status(400).json({ message: "You have already submitted this exam" });
        }
        // Create new submission if absolutely no submission exists (edge case)
        submission = new Submission({
          examId,
          studentId: user._id,
          ...snapshotFieldsFromUser(user),
          status: "processing_submission",
          submittedAt: new Date(),
          startedAt: new Date(),
          maxScore: exam.questions.reduce((sum, q) => sum + q.points, 0),
        });
        await submission.save();
      }
    }

    // ── Timer Verification (Server Authoritative) ──────────
    // The student gets exam.duration minutes from when they started.
    // We add a 60-second grace period for network latency during auto-submit.
    const individualEndTime = new Date(submission.startedAt.getTime() + (exam.duration * 60000) + 60000);
    const isLate = now > individualEndTime;
    
    // If they are late, we ignore the answers in the request payload and just grade what was auto-saved
    let finalAnswersToGrade = answers;
    if (isLate) {
      console.warn(`Late submission blocked for ${user.email}. Grading auto-saved answers only.`);
      finalAnswersToGrade = submission.answers || [];
    }

    // ── Grading: deterministic split (instant exact-match vs manual review) ──
    let mcqScore = 0;
    let hasTextQuestions = false;

    const processedAnswers = (finalAnswersToGrade || []).map((answer) => {
      const question = exam.questions.id(answer.questionId);
      const answerData = {
        questionId: answer.questionId,
        answer: answer.answer || "",
        updatedAt: new Date(),
        gradingStatus: "ungraded",
        gradingMethod: "exact_match",
        isCorrect: false,
        slmScore: null,
        marksAwarded: 0,
      };

      if (question) {
        if (EXACT_MATCH_TYPES.includes(question.type)) {
          // MCQ / true_false / fill_blank — graded instantly via exact match
          const result = gradeMCQ(answer.answer, question.correctAnswer);
          answerData.isCorrect = result.isCorrect;
          answerData.marksAwarded = result.isCorrect ? question.points : 0;
          answerData.gradingStatus = "graded";
          answerData.gradingMethod = "exact_match";
          mcqScore += answerData.marksAwarded;
        } else if (MANUAL_REVIEW_TYPES.includes(question.type)) {
          // Text-based — awaits coordinator review; no automated scoring.
          hasTextQuestions = true;
          answerData.gradingStatus = "pending_review";
          answerData.gradingMethod = "manual_review";
        }
      }

      return answerData;
    });

    submission.answers = processedAnswers;
    submission.score = mcqScore; // Final for auto-graded parts; text answers are added by coordinators
    submission.submittedAt = new Date();
    submission.tabSwitchCount =
      tabSwitchCount || submission.tabSwitchCount || 0;
    submission.fullscreenExitCount =
      fullscreenExitCount || submission.fullscreenExitCount || 0;

    // Flag if too many violations
    if ((tabSwitchCount || 0) > 5 || (fullscreenExitCount || 0) > 3) {
      submission.isFlagged = true;
      submission.flagReason = `High violation count: ${tabSwitchCount} tab switches, ${fullscreenExitCount} fullscreen exits`;
    }

    if (hasTextQuestions) {
      // Has text answers → auto-graded parts done, rest awaits coordinator review
      submission.status = "partially_graded";
      await submission.save();
    } else {
      // All questions exact-match — fully graded immediately
      submission.status = "graded";
      submission.gradingCompletedAt = new Date();
      await submission.save();
    }

    // Incremental, atomic statistics — no O(N) submissions scan during the
    // final-submit burst. percentageSum keeps the running mean drift-free;
    // coordinator overrides adjust it by the delta when manual marks land.
    await Exam.findByIdAndUpdate(examId, [
      {
        $set: {
          totalSubmissions: { $add: [{ $ifNull: ["$totalSubmissions", 0] }, 1] },
          percentageSum: {
            $add: [
              {
                $ifNull: [
                  "$percentageSum",
                  // Seed lazily for legacy exams that only stored the average
                  { $multiply: [{ $ifNull: ["$averageScore", 0] }, { $ifNull: ["$totalSubmissions", 0] }] },
                ],
              },
              submission.percentage || 0,
            ],
          },
        },
      },
      {
        $set: {
          averageScore: {
            $round: [
              { $divide: ["$percentageSum", { $max: [{ $ifNull: ["$totalSubmissions", 0] }, 1] }] },
              0,
            ],
          },
        },
      },
    ]);

    // Create notification for student — never leaks the score, results are
    // only released after the exam window closes (+5 min buffer).
    await Notification.create({
      userId: user._id,
      type: "exam_submitted",
      title: "Exam Submitted",
      message: `Your submission for "${exam.title}" has been received. Results will be available after the exam ends.`,
      data: { examId, submissionId: submission._id },
      priority: "medium",
    });

    // Notify teacher if submission is flagged
    if (submission.isFlagged) {
      await Notification.create({
        userId: exam.teacherId,
        type: "flagged_submission",
        title: "Flagged Submission",
        message: `A submission for "${exam.title}" has been flagged for review`,
        data: { examId, submissionId: submission._id },
        priority: "high",
      });
    }

    // Results stay hidden until the whole exam window closes (+5 min) — the
    // submit response carries no score data before that.
    const released = resultsReleasedFor(exam);

    // *** RESPOND IMMEDIATELY — grading of exact-match parts is already done ***
    res.status(201).json({
      submission,
      message: !released
        ? "Exam submitted successfully — results will be available after the exam window closes"
        : hasTextQuestions
          ? "Exam submitted — text answers pending coordinator review"
          : "Exam submitted successfully",
      ...(released
        ? {
            score: submission.score,
            maxScore: submission.maxScore,
            percentage: submission.percentage,
          }
        : {
            resultsPending: true,
            resultsReleaseAt:
              examResultsReleaseAt(exam)?.toISOString() ?? null,
          }),
      gradingStatus: hasTextQuestions ? "pending_review" : "completed",
    });
  } catch (error) {
    console.error("Error submitting exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get submissions for an exam (Teacher only)
router.get("/exam/:examId", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const exam = await Exam.findById(req.params.examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // Teachers can only see their own exam submissions
    if (
      user.role === "coordinator" &&
      exam.teacherId.toString() !== user._id.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You can only view submissions for your own exams" });
    }

    // Bound the result set — a single exam realistically has ≤ a few hundred
    // submissions; the cap protects against unbounded growth over many exams.
    const submissions = applyStudentSnapshotFallback(
      await Submission.find({ examId: req.params.examId })
        .populate("studentId", "name email")
        .sort({ submittedAt: -1 })
        .limit(2000)
        .lean(),
    );

    // Calculate statistics
    const scoredSubmissions = submissions.filter(
      (s) => ["submitted", "graded", "partially_graded"].includes(s.status),
    );
    const stats = {
      total: submissions.length,
      submitted: submissions.filter((s) => s.status === "submitted").length,
      inProgress: submissions.filter((s) => s.status === "in_progress").length,
      flagged: submissions.filter((s) => s.isFlagged).length,
      averageScore:
        scoredSubmissions.length > 0
          ? Math.round(
              scoredSubmissions.reduce((sum, s) => sum + s.percentage, 0) /
                scoredSubmissions.length,
            )
          : 0,
      highestScore:
        scoredSubmissions.length > 0
          ? Math.max(...scoredSubmissions.map((s) => s.percentage))
          : 0,
      lowestScore:
        scoredSubmissions.length > 0
          ? Math.min(...scoredSubmissions.map((s) => s.percentage))
          : 0,
    };

    res.json({ submissions, stats });
  } catch (error) {
    console.error("Error getting submissions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get student's own submissions
router.get("/my-submissions", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const submissions = await Submission.find({
      studentId: user._id,
      status: { $in: ["submitted", "grading", "graded", "partially_graded", "locked"] },
    })
      .populate(
        "examId",
        "title description duration scheduledAt endTime settings questions sections",
      )
      .sort({ submittedAt: -1 })
      .lean();

    // Filter out submissions with deleted exams and sanitize data
    const cleanSubmissions = submissions
      .filter((s) => s.examId != null)
      .map((s) => {
        const cleaned = {
          ...s,
          percentage: isNaN(s.percentage) ? 0 : s.percentage,
          score: isNaN(s.score) ? 0 : s.score,
        };

        // Sections are organizational metadata — students only need id+name
        // so the results view can group questions section-wise.
        if (Array.isArray(cleaned.examId?.sections)) {
          cleaned.examId.sections = cleaned.examId.sections.map((sec) => ({
            _id: sec._id,
            name: sec.name,
          }));
        }

        // Results are hidden until the exam window closes (+5 min buffer).
        gateResultsForStudent(cleaned, s.examId);

        // Strip correct answers if teacher disabled immediate results
        if (s.examId?.settings?.showResultsImmediately === false) {
          cleaned.examId = {
            ...s.examId,
            questions: s.examId.questions?.map((q) => ({
              ...q,
              correctAnswer: undefined,
              modelAnswer: undefined,
              explanation: undefined,
            })),
          };
        }

        return cleaned;
      });

    res.json({ submissions: cleanSubmissions });
  } catch (error) {
    console.error("Error getting submissions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single submission details
router.get("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const submission = await Submission.findById(req.params.id)
      .populate("studentId", "name email")
      .populate("examId")
      .populate("reviewedBy", "name");

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Students can only view their own submissions
    if (
      user.role === "student" &&
      submission.studentId._id.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Teachers can only view submissions for their exams
    if (
      user.role === "coordinator" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Sanitize for students: hide scores until release, then strip correct
    // answers if showResultsImmediately is false
    if (user.role === "student") {
      const submissionObj = submission.toObject();
      gateResultsForStudent(submissionObj, submissionObj.examId);
      if (submissionObj.examId?.settings?.showResultsImmediately === false) {
        submissionObj.score = 0;
        submissionObj.percentage = 0;
        submissionObj.answers = submissionObj.answers?.map(a => ({
          ...a,
          isCorrect: undefined,
          marksAwarded: undefined,
          slmScore: undefined
        }));
        submissionObj.examId.questions = submissionObj.examId.questions?.map((q) => ({
          ...q,
          correctAnswer: undefined,
          modelAnswer: undefined,
          explanation: undefined,
        }));
      }
      // Strip proctoring data from student view — they shouldn't see their own events
      delete submissionObj.proctoringEvents;
      delete submissionObj.webcamSnapshots;
      delete submissionObj.proctoringScore;
      return res.json({ submission: applyStudentSnapshotFallback(submissionObj) });
    }

    res.json({ submission: applyStudentSnapshotFallback(submission.toObject()) });
  } catch (error) {
    console.error("Error getting submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Review/Grade submission (Teacher only)
router.put("/:id/review", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { score, reviewNotes, isFlagged, flagReason } = req.body;

    const submission = await Submission.findById(req.params.id).populate(
      "examId",
    );

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Teachers can only review their own exam submissions
    if (
      user.role === "coordinator" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (score !== undefined) {
      submission.score = score;
    }
    if (reviewNotes) {
      submission.reviewNotes = reviewNotes;
    }
    if (isFlagged !== undefined) {
      submission.isFlagged = isFlagged;
    }
    if (flagReason) {
      submission.flagReason = flagReason;
    }

    submission.reviewedBy = user._id;
    submission.reviewedAt = new Date();
    submission.status = "graded";

    await submission.save();

    // Notify student
    await Notification.create({
      userId: submission.studentId,
      type: "exam_graded",
      title: "Exam Graded",
      message: `Your submission for "${submission.examId.title}" has been reviewed`,
      data: { submissionId: submission._id },
      priority: "medium",
    });

    res.json({ submission, message: "Submission reviewed" });
  } catch (error) {
    console.error("Error reviewing submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Unlock a locked submission (Teacher/Admin only)
router.put("/:id/unlock", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["coordinator", "admin", "super_admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const submission = await Submission.findById(req.params.id).populate(
      "examId",
    );

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    if (submission.status !== "locked") {
      return res
        .status(400)
        .json({ message: "Submission is not locked" });
    }

    // Teachers can only unlock submissions for their own exams
    if (
      user.role === "coordinator" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Unlock the submission — set to "submitted" so the teacher can grade it
    submission.status = "submitted";
    submission.lockInfo.unlockedAt = new Date();
    submission.lockInfo.unlockedBy = user._id;

    await submission.save();

    // Notify the student
    await Notification.create({
      userId: submission.studentId,
      type: "exam_graded",
      title: "Exam Unlocked",
      message: `Your locked exam "${submission.examId.title}" has been reviewed by your teacher. You may view your results.`,
      data: {
        examId: submission.examId._id,
        submissionId: submission._id,
      },
      priority: "high",
    });

    res.json({ submission, message: "Submission unlocked successfully" });
  } catch (error) {
    console.error("Error unlocking submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
