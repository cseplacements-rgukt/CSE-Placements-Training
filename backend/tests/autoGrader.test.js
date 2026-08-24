const mongoose = require("mongoose");

beforeAll(async () => {

});

afterAll(async () => {

});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
  jest.clearAllMocks();
});

const {
  gradeMCQ,
  gradeFillBlank,
  regradeSubmission,
  EXACT_MATCH_TYPES,
  MANUAL_REVIEW_TYPES,
} = require("../services/autoGrader");

const Submission = require("../models/Submission");
const Exam = require("../models/Exam");
const User = require("../models/User");

// ═══════════════════════════════════════════════════════════════════
// AUTOGRADER SERVICE TESTS — deterministic, offline (no AI/SLM calls)
// ═══════════════════════════════════════════════════════════════════

describe("AutoGrader Service", () => {
  let teacher, student, exam;

  beforeEach(async () => {
    teacher = await User.create({
      firebaseUid: "teacher_uid",
      email: "teacher@test.com",
      name: "Teacher",
      role: "coordinator",
    });

    student = await User.create({
      firebaseUid: "student_uid",
      email: "student@test.com",
      name: "Student",
      role: "student",
    });

    exam = await Exam.create({
      title: "Grading Test Exam",
      teacherId: teacher._id,
      targetCompany: "TestCompany",
      questions: [
        {
          type: "mcq",
          question: "What is 2+2?",
          options: ["3", "4", "5"],
          correctAnswer: "4",
          modelAnswer: "4",
          points: 5,
        },
        {
          type: "true_false",
          question: "Is the sky blue?",
          options: ["True", "False"],
          correctAnswer: "True",
          modelAnswer: "True",
          points: 3,
        },
        {
          type: "short_answer",
          question: "What is photosynthesis?",
          correctAnswer: "The process by which plants convert sunlight into food",
          modelAnswer:
            "Photosynthesis is the process by which green plants use sunlight to synthesize food from carbon dioxide and water.",
          points: 10,
        },
        {
          type: "essay",
          question: "Explain the water cycle",
          correctAnswer: "The water cycle describes how water evaporates, condenses, and precipitates",
          modelAnswer:
            "The water cycle is the continuous movement of water within the Earth and atmosphere through evaporation, condensation, precipitation, and collection.",
          points: 20,
        },
      ],
      scheduledAt: new Date(),
      duration: 60,
      endTime: new Date(Date.now() + 60 * 60000),
    });
  });

  // ─── Exact Match ─────────────────────────────────────────────

  describe("gradeMCQ — Exact Match Grading", () => {
    test("should mark correct MCQ answer", () => {
      const result = gradeMCQ("4", "4");
      expect(result.isCorrect).toBe(true);
      expect(result.gradingStatus).toBe("graded");
      expect(result.gradingMethod).toBe("exact_match");
    });

    test("should mark incorrect MCQ answer", () => {
      const result = gradeMCQ("3", "4");
      expect(result.isCorrect).toBe(false);
    });

    test("should be case-insensitive", () => {
      const result = gradeMCQ("TRUE", "true");
      expect(result.isCorrect).toBe(true);
    });

    test("should trim whitespace", () => {
      const result = gradeMCQ("  True  ", "True");
      expect(result.isCorrect).toBe(true);
    });

    test("should handle empty/null student answer", () => {
      expect(gradeMCQ("", "True").isCorrect).toBe(false);
    });

    test("should handle null student answer", () => {
      expect(gradeMCQ(null, "True").isCorrect).toBe(false);
    });
  });

  describe("gradeFillBlank — Exact Match Grading", () => {
    test("should grade fill_blank via exact match", () => {
      expect(gradeFillBlank("Oxygen", "oxygen").isCorrect).toBe(true);
      expect(gradeFillBlank("Nitrogen", "oxygen").isCorrect).toBe(false);
    });
  });

  // ─── Question Type Constants ──────────────────────────────────

  describe("Question Type Constants", () => {
    test("EXACT_MATCH_TYPES covers auto-gradable types only", () => {
      expect(EXACT_MATCH_TYPES).toContain("mcq");
      expect(EXACT_MATCH_TYPES).toContain("true_false");
      expect(EXACT_MATCH_TYPES).toContain("fill_blank");
      expect(EXACT_MATCH_TYPES).not.toContain("essay");
    });

    test("MANUAL_REVIEW_TYPES routes text answers to coordinator review", () => {
      expect(MANUAL_REVIEW_TYPES).toContain("short_answer");
      expect(MANUAL_REVIEW_TYPES).toContain("essay");
      expect(MANUAL_REVIEW_TYPES).not.toContain("mcq");
    });
  });

  // ─── regradeSubmission — Full Submission Grading ─────────────

  describe("regradeSubmission — Full Submission Re-grading", () => {
    const buildAnswers = () => [
      { questionId: exam.questions[0]._id, answer: "4" },
      { questionId: exam.questions[1]._id, answer: "TRUE" },
      { questionId: exam.questions[2]._id, answer: "Plants make food from sunlight" },
      { questionId: exam.questions[3]._id, answer: "Water moves between earth and sky" },
    ];

    const createSubmission = async () =>
      Submission.create({
        examId: exam._id,
        studentId: student._id,
        answers: buildAnswers().map((a) => ({
          ...a,
          gradingStatus: "ungraded",
          marksAwarded: 0,
        })),
        status: "submitted",
        maxScore: exam.questions.reduce((s, q) => s + q.points, 0),
      });

    test("should grade exact-match answers and mark text answers pending_review", async () => {
      const submission = await createSubmission();

      const result = await regradeSubmission(submission._id.toString());

      expect(result.hasPendingReview).toBe(true);
      expect(result.totalScore).toBe(8); // mcq(5) + true_false(3)

      const updated = await Submission.findById(submission._id);
      expect(updated.status).toBe("partially_graded");

      const byQuestion = Object.fromEntries(
        updated.answers.map((a) => [String(a.questionId), a]),
      );
      expect(byQuestion[String(exam.questions[0]._id)].marksAwarded).toBe(5);
      expect(byQuestion[String(exam.questions[0]._id)].gradingMethod).toBe("exact_match");
      expect(byQuestion[String(exam.questions[1]._id)].marksAwarded).toBe(3); // case-insensitive
      expect(byQuestion[String(exam.questions[2]._id)].gradingStatus).toBe("pending_review");
      expect(byQuestion[String(exam.questions[2]._id)].marksAwarded).toBe(0);
      expect(byQuestion[String(exam.questions[3]._id)].gradingStatus).toBe("pending_review");
    });

    test("should fully grade an all-exact-match submission", async () => {
      const submission = await Submission.create({
        examId: exam._id,
        studentId: student._id,
        answers: [
          { questionId: exam.questions[0]._id, answer: "4", gradingStatus: "ungraded" },
          { questionId: exam.questions[1]._id, answer: "True", gradingStatus: "ungraded" },
        ],
        status: "submitted",
        maxScore: 8,
      });

      const result = await regradeSubmission(submission._id.toString());

      expect(result.hasPendingReview).toBe(false);
      expect(result.totalScore).toBe(8);

      const updated = await Submission.findById(submission._id);
      expect(updated.status).toBe("graded");
      expect(updated.gradingCompletedAt).toBeDefined();
    });

    test("should preserve coordinator-awarded manual marks on regrade", async () => {
      const submission = await Submission.create({
        examId: exam._id,
        studentId: student._id,
        answers: [
          { questionId: exam.questions[0]._id, answer: "wrong", gradingStatus: "ungraded" },
          {
            questionId: exam.questions[2]._id,
            answer: "Some attempt",
            gradingStatus: "graded",
            gradingMethod: "manual_review",
            marksAwarded: 7,
          },
        ],
        status: "partially_graded",
        maxScore: 15,
      });

      const result = await regradeSubmission(submission._id.toString());

      expect(result.totalScore).toBe(7); // 0 from MCQ + 7 preserved manual marks
      expect(result.hasPendingReview).toBe(false);

      const updated = await Submission.findById(submission._id);
      expect(updated.status).toBe("graded");
    });

    test("should throw for a missing submission", async () => {
      const badId = new mongoose.Types.ObjectId();
      await expect(regradeSubmission(badId.toString())).rejects.toThrow(/not found/);
    });
  });
});
