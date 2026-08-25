const Submission = require("../models/Submission");
const Exam = require("../models/Exam");
const ProctoringSession = require("../models/ProctoringSession");
const Notification = require("../models/Notification");
const { gradeMCQ, EXACT_MATCH_TYPES, MANUAL_REVIEW_TYPES } = require("./autoGrader");

// Same grace the submit route allows after exam.endTime (submissions.js) —
// a submission is only finalized once even the server would reject a client.
const GLOBAL_GRACE_MS = 5 * 60 * 1000;
// A processing_submission lock older than this is a crashed request, matching
// the crash-recovery window in POST /api/submissions/start.
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const MAX_PER_RUN = 200;

let running = false;

async function finalizeExpiredSubmissions({ now = new Date() } = {}) {
  if (running) return { skipped: true, finalized: 0, details: [] };
  running = true;

  const details = [];
  let finalizedCount = 0;

  try {
    const processingStaleBefore = new Date(now.getTime() - PROCESSING_STALE_MS);

    const candidates = await Submission.find({
      $or: [
        { status: "in_progress" },
        {
          status: "processing_submission",
          submittedAt: { $lte: processingStaleBefore },
        },
      ],
    })
      .sort({ startedAt: 1 })
      .limit(MAX_PER_RUN)
      .populate("examId", "title endTime duration teacherId questions");

    for (const submission of candidates) {
      const exam = submission.examId;
      if (!exam || !exam.endTime) continue;

      const deadline = new Date(new Date(exam.endTime).getTime() + GLOBAL_GRACE_MS);
      if (now <= deadline) continue;
      if (
        submission.status === "processing_submission" &&
        submission.submittedAt &&
        submission.submittedAt > processingStaleBefore
      ) {
        continue;
      }

      try {
        // Carry authoritative proctoring data over from the session — the
        // client normally posts these counts with its own submit call,
        // which never happened here.
        const latestSession = await ProctoringSession.findOne({
          submissionId: submission._id,
        })
          .sort({ startedAt: -1 })
          .select("trustScore eventSummary")
          .lean();
        const tabSwitches =
          latestSession?.eventSummary?.tabSwitches ?? submission.tabSwitchCount ?? 0;
        const fullscreenExits =
          latestSession?.eventSummary?.fullscreenExits ??
          submission.fullscreenExitCount ??
          0;
        submission.tabSwitchCount = tabSwitches;
        submission.fullscreenExitCount = fullscreenExits;
        if (typeof latestSession?.trustScore === "number") {
          submission.proctoringScore = latestSession.trustScore;
        }
        if (tabSwitches > 5 || fullscreenExits > 3) {
          submission.isFlagged = true;
          submission.flagReason = `High violation count: ${tabSwitches} tab switches, ${fullscreenExits} fullscreen exits`;
        }

        // Grade from the last auto-saved answers — identical rules to the
        // late-submission path in POST /api/submissions.
        let mcqScore = 0;
        let hasTextQuestions = false;
        submission.answers = (submission.answers || []).map((answer) => {
          const question = exam.questions.id(answer.questionId);
          const answerData = {
            questionId: answer.questionId,
            answer: answer.answer || "",
            updatedAt: now,
            gradingStatus: "ungraded",
            gradingMethod: "exact_match",
            isCorrect: false,
            slmScore: null,
            marksAwarded: 0,
          };
          if (question) {
            if (EXACT_MATCH_TYPES.includes(question.type)) {
              const result = gradeMCQ(answer.answer, question.correctAnswer);
              answerData.isCorrect = result.isCorrect;
              answerData.marksAwarded = result.isCorrect ? question.points : 0;
              answerData.gradingStatus = "graded";
              mcqScore += answerData.marksAwarded;
            } else if (MANUAL_REVIEW_TYPES.includes(question.type)) {
              hasTextQuestions = true;
              answerData.gradingStatus = "pending_review";
              answerData.gradingMethod = "manual_review";
            }
          }
          return answerData;
        });

        if (!submission.maxScore) {
          submission.maxScore = exam.questions.reduce(
            (sum, q) => sum + q.points,
            0
          );
        }
        submission.score = mcqScore;
        submission.submittedAt = now;
        submission.status = hasTextQuestions ? "partially_graded" : "graded";
        if (!hasTextQuestions) {
          submission.gradingCompletedAt = now;
        }
        submission.systemFinalized = true;
        submission.systemFinalizedAt = now;
        await submission.save();

        // Close any proctoring sessions left open by the vanished client.
        await ProctoringSession.updateMany(
          { submissionId: submission._id, status: { $in: ["active", "paused"] } },
          { $set: { status: "ended", endedAt: now } }
        );

        // Same incremental stats pipeline as the submit route.
        await Exam.findByIdAndUpdate(exam._id, [
          {
            $set: {
              totalSubmissions: {
                $add: [{ $ifNull: ["$totalSubmissions", 0] }, 1],
              },
              percentageSum: {
                $add: [
                  {
                    $ifNull: [
                      "$percentageSum",
                      {
                        $multiply: [
                          { $ifNull: ["$averageScore", 0] },
                          { $ifNull: ["$totalSubmissions", 0] },
                        ],
                      },
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
                  {
                    $divide: [
                      "$percentageSum",
                      { $max: [{ $ifNull: ["$totalSubmissions", 0] }, 1] },
                    ],
                  },
                  0,
                ],
              },
            },
          },
        ]);

        await Notification.create({
          userId: submission.studentId,
          type: "exam_submitted",
          title: "Exam Auto-Submitted",
          message: `Your attempt for "${exam.title}" was closed automatically because the exam time ended. Your saved answers have been recorded and will be graded.`,
          data: { examId: exam._id, submissionId: submission._id },
          priority: "medium",
        });
        if (submission.isFlagged) {
          await Notification.create({
            userId: exam.teacherId,
            type: "flagged_submission",
            title: "Flagged Submission",
            message: `An auto-finalized submission for "${exam.title}" has been flagged for review`,
            data: { examId: exam._id, submissionId: submission._id },
            priority: "high",
          });
        }

        finalizedCount += 1;
        details.push({
          submissionId: submission._id,
          examTitle: exam.title,
          studentName: submission.studentName || String(submission.studentId),
          status: submission.status,
        });
      } catch (error) {
        console.error(
          `[submissionSweeper] Failed to finalize submission ${submission._id}:`,
          error.message
        );
      }
    }

    return { finalized: finalizedCount, details };
  } finally {
    running = false;
  }
}

function startSubmissionSweeper(intervalMs = 60 * 1000) {
  const run = async () => {
    try {
      const result = await finalizeExpiredSubmissions();
      if (result.finalized > 0) {
        console.log(
          `[submissionSweeper] Finalized ${result.finalized} stale submission(s):`,
          result.details
            .map((d) => `${d.studentName} (${d.examTitle}) → ${d.status}`)
            .join("; ")
        );
      }
    } catch (error) {
      console.error("[submissionSweeper] Sweep failed:", error.message);
    }
  };

  setTimeout(run, 15 * 1000).unref?.();
  setInterval(run, intervalMs).unref?.();
  console.log("[submissionSweeper] Running every", intervalMs / 1000, "s");
}

module.exports = { finalizeExpiredSubmissions, startSubmissionSweeper };
