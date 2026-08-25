const mongoose = require("mongoose");

beforeAll(async () => {});

afterAll(async () => {});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

const Submission = require("../models/Submission");
const Exam = require("../models/Exam");
const User = require("../models/User");
const ProctoringSession = require("../models/ProctoringSession");
const Notification = require("../models/Notification");
const {
  finalizeExpiredSubmissions,
} = require("../services/submissionSweeper");

// ═══════════════════════════════════════════════════════════════════
// SUBMISSION SWEEPER TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Submission Sweeper", () => {
  let teacher, student, exam;

  const createExam = async (overrides = {}) => {
    return Exam.create({
      title: "Sweeper Exam",
      teacherId: teacher._id,
      targetCompany: "TestCompany",
      questions: [
        {
          type: "mcq",
          question: "What is 2+2?",
          correctAnswer: "4",
          options: ["3", "4", "5"],
          points: 10,
        },
        {
          type: "mcq",
          question: "Capital of France?",
          correctAnswer: "paris",
          options: ["london", "paris", "rome"],
          points: 10,
        },
      ],
      scheduledAt: new Date(Date.now() - 120 * 60000),
      duration: 60,
      endTime: new Date(Date.now() - 30 * 60000),
      ...overrides,
    });
  };

  const createStaleSubmission = async (examDoc, overrides = {}) => {
    return Submission.create({
      examId: examDoc._id,
      studentId: student._id,
      studentName: "Test Student",
      startedAt: new Date(examDoc.endTime.getTime() - 60 * 60000),
      maxScore: 20,
      answers: [
        {
          questionId: examDoc.questions[0]._id,
          answer: "4",
        },
        {
          questionId: examDoc.questions[1]._id,
          answer: "rome",
        },
      ],
      ...overrides,
    });
  };

  beforeEach(async () => {
    teacher = await User.create({
      firebaseUid: "teacher_uid_sweeper",
      email: "sweeper-teacher@test.com",
      name: "Teacher",
      role: "coordinator",
    });
    student = await User.create({
      firebaseUid: "student_uid_sweeper",
      email: "sweeper-student@test.com",
      name: "Student",
      role: "student",
    });
    exam = await createExam();
  });

  test("finalizes an expired in_progress submission from auto-saved answers", async () => {
    const sub = await createStaleSubmission(exam);

    const result = await finalizeExpiredSubmissions();

    expect(result.finalized).toBe(1);
    const updated = await Submission.findById(sub._id);
    expect(updated.status).toBe("graded");
    expect(updated.score).toBe(10); // only the correct MCQ scores
    expect(updated.percentage).toBe(50);
    expect(updated.systemFinalized).toBe(true);
    expect(updated.systemFinalizedAt).toBeTruthy();
    expect(updated.submittedAt).toBeTruthy();

    const statsExam = await Exam.findById(exam._id);
    expect(statsExam.totalSubmissions).toBe(1);
  });

  test("skips submissions whose exam window is still open", async () => {
    const liveExam = await createExam({
      endTime: new Date(Date.now() + 60 * 60000),
    });
    const sub = await createStaleSubmission(liveExam);

    const result = await finalizeExpiredSubmissions();

    expect(result.finalized).toBe(0);
    const unchanged = await Submission.findById(sub._id);
    expect(unchanged.status).toBe("in_progress");
    expect(unchanged.systemFinalized).toBe(false);
  });

  test("marks partially_graded when text answers need coordinator review", async () => {
    const textExam = await Exam.create({
      title: "Text Exam",
      teacherId: teacher._id,
      targetCompany: "TestCompany",
      questions: [
        {
          type: "essay",
          question: "Explain OOP.",
          correctAnswer: "Object-oriented programming...",
          points: 20,
        },
      ],
      scheduledAt: new Date(Date.now() - 120 * 60000),
      duration: 60,
      endTime: new Date(Date.now() - 30 * 60000),
    });
    const sub = await Submission.create({
      examId: textExam._id,
      studentId: student._id,
      startedAt: new Date(textExam.endTime.getTime() - 60 * 60000),
      maxScore: 20,
      answers: [{ questionId: textExam.questions[0]._id, answer: "My essay" }],
    });

    await finalizeExpiredSubmissions();

    const updated = await Submission.findById(sub._id);
    expect(updated.status).toBe("partially_graded");
    expect(updated.answers[0].gradingStatus).toBe("pending_review");
    expect(updated.answers[0].gradingMethod).toBe("manual_review");
  });

  test("carries proctoring data and flags high violation counts", async () => {
    const sub = await createStaleSubmission(exam);
    await ProctoringSession.create({
      submissionId: sub._id,
      studentId: student._id,
      examId: exam._id,
      status: "active",
      trustScore: 40,
      eventSummary: { tabSwitches: 7, fullscreenExits: 0 },
    });

    await finalizeExpiredSubmissions();

    const updated = await Submission.findById(sub._id);
    expect(updated.proctoringScore).toBe(40);
    expect(updated.tabSwitchCount).toBe(7);
    expect(updated.isFlagged).toBe(true);
    expect(updated.flagReason).toContain("7 tab switches");

    // Active proctoring sessions are closed by the sweep.
    const session = await ProctoringSession.findOne({ submissionId: sub._id });
    expect(session.status).toBe("ended");
    expect(session.endedAt).toBeTruthy();
  });

  test("creates notifications for the student after finalizing", async () => {
    const sub = await createStaleSubmission(exam);

    await finalizeExpiredSubmissions();

    const notifications = await Notification.find({
      userId: student._id,
    }).lean();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("exam_submitted");
    expect(notifications[0].data.submissionId.toString()).toBe(
      sub._id.toString()
    );
  });

  test("finalizes stale processing_submission locks older than 10 minutes", async () => {
    const sub = await createStaleSubmission(exam, {
      status: "processing_submission",
      submittedAt: new Date(Date.now() - 15 * 60000),
    });

    const result = await finalizeExpiredSubmissions();

    expect(result.finalized).toBe(1);
    const updated = await Submission.findById(sub._id);
    expect(["graded", "partially_graded"]).toContain(updated.status);
  });

  test("leaves fresh processing_submission locks alone (request may be live)", async () => {
    await createStaleSubmission(exam, {
      status: "processing_submission",
      submittedAt: new Date(),
    });

    const result = await finalizeExpiredSubmissions();

    expect(result.finalized).toBe(0);
    const count = await Submission.countDocuments({
      status: "processing_submission",
    });
    expect(count).toBe(1);
  });
});
