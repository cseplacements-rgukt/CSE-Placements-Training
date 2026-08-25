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
});

const Exam = require("../models/Exam");
const User = require("../models/User");

// ═══════════════════════════════════════════════════════════════════
// EXAM MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Exam Model", () => {
  let teacherId;

  beforeEach(async () => {
    const teacher = await User.create({
      firebaseUid: "teacher_uid",
      email: "teacher@test.com",
      name: "Teacher",
      role: "coordinator",
    });
    teacherId = teacher._id;
  });

  // ─── OO Checks: Schema structure ─────────────────────────────────
  describe("OO Checks: Schema and subdocuments", () => {
    test("should create an exam with all required fields", async () => {
      const exam = await Exam.create({
        title: "Math Exam",
        teacherId,
        targetCompany: "TestCompany",
        questions: [
          {
            type: "mcq",
            question: "What is 2+2?",
            options: ["3", "4", "5"],
            correctAnswer: "4",
            points: 5,
          },
        ],
        scheduledAt: new Date("2026-04-01T10:00:00Z"),
        duration: 60,
        endTime: new Date("2026-04-01T11:00:00Z"),
      });

      expect(exam.title).toBe("Math Exam");
      expect(exam.teacherId.toString()).toBe(teacherId.toString());
      expect(exam.questions).toHaveLength(1);
      expect(exam.duration).toBe(60);
    });

    test("should apply default settings", async () => {
      const exam = await Exam.create({
        title: "Defaults Exam",
        teacherId,
        targetCompany: "TestCompany",
        questions: [
          {
            type: "true_false",
            question: "Is Earth round?",
            correctAnswer: "True",
          },
        ],
        scheduledAt: new Date(),
        duration: 30,
        endTime: new Date(Date.now() + 30 * 60000),
      });

      expect(exam.settings.shuffleQuestions).toBe(false);
      expect(exam.settings.shuffleOptions).toBe(false);
      expect(exam.settings.showResultsImmediately).toBe(true);
      expect(exam.settings.allowBackNavigation).toBe(true);
      expect(exam.settings.requireWebcam).toBe(true);
      expect(exam.settings.requireFullscreen).toBe(true);
      expect(exam.settings.maxAttempts).toBe(1);
      expect(exam.settings.passingScore).toBe(50);
      expect(exam.settings.autoSubmitOnTimeUp).toBe(true);
      expect(exam.settings.enableCalculator).toBe(false);
    });

  });

  // ─── Logic Checks: Virtual totalPoints ─────────────────────────
  describe("Logic Checks: Virtual totalPoints calculation", () => {
    test("should calculate total points from questions", async () => {
      const exam = await Exam.create({
        title: "Points Exam",
        teacherId,
        targetCompany: "TestCompany",
        questions: [
          { type: "mcq", question: "Q1?", correctAnswer: "A", options: ["A"], points: 10 },
          { type: "mcq", question: "Q2?", correctAnswer: "B", options: ["B"], points: 20 },
          { type: "mcq", question: "Q3?", correctAnswer: "C", options: ["C"], points: 30 },
        ],
        scheduledAt: new Date(),
        duration: 60,
        endTime: new Date(Date.now() + 60 * 60000),
      });

      expect(exam.totalPoints).toBe(60);
    });
  });

  // ─── Error Handling: Required field validation ──────────────────
  describe("Error Handling: Required fields", () => {
    test("should fail without title", async () => {
      await expect(
        Exam.create({
          teacherId,
          targetCompany: "TestCompany",
          questions: [],
          scheduledAt: new Date(),
          duration: 30,
          endTime: new Date(),
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // ─── Boundary Checks ─────────────────────────────────────────────
  // ─── Boundary Checks ─────────────────────────────────────────────
  describe("Boundary Checks: Edge case values", () => {
    test("should allow an exam creation with 0 questions initially", async () => {
      const exam = await Exam.create({
        title: "Empty Validation Exam",
        teacherId,
        targetCompany: "TestCompany",
        questions: [],
        scheduledAt: new Date(),
        duration: 180,
        endTime: new Date(Date.now() + 180 * 60000),
      });

      expect(exam.questions).toHaveLength(0);
      expect(exam.totalPoints).toBe(0);
    });

    test("should reject an exam with 0 duration natively via validation", async () => {
      await expect(
        Exam.create({
          title: "Zero Duration Exam",
          teacherId,
          targetCompany: "TestCompany",
          questions: [],
          scheduledAt: new Date(),
          duration: 0,
          endTime: new Date(),
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });
});