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

const Submission = require("../models/Submission");
const Exam = require("../models/Exam");
const User = require("../models/User");

// ═══════════════════════════════════════════════════════════════════
// SUBMISSION MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Submission Model", () => {
  let studentId, examId;

  beforeEach(async () => {
    const student = await User.create({
      firebaseUid: "student_uid",
      email: "student@test.com",
      name: "Student",
      role: "student",
    });
    studentId = student._id;

    const teacher = await User.create({
      firebaseUid: "teacher_uid",
      email: "teacher@test.com",
      name: "Teacher",
      role: "teacher",
    });

    const exam = await Exam.create({
      title: "Test Exam",
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
      ],
      scheduledAt: new Date(),
      duration: 60,
      endTime: new Date(Date.now() + 60 * 60000),
    });
    examId = exam._id;
  });

  // ─── OO Checks: Schema defaults ─────────────────────────────────
  describe("OO Checks: Schema defaults and structure", () => {
    test("should create a submission with required fields", async () => {
      const sub = await Submission.create({
        examId,
        studentId,
      });

      expect(sub.examId.toString()).toBe(examId.toString());
      expect(sub.studentId.toString()).toBe(studentId.toString());
    });

  });

  // ─── Logic Checks: Percentage pre-save calculation ──────────────
  describe("Logic Checks: Percentage calculation (pre-save hook)", () => {
    test("should calculate percentage correctly on save", async () => {
      const sub = new Submission({
        examId,
        studentId,
        score: 75,
        maxScore: 100,
      });
      await sub.save();
      expect(sub.percentage).toBe(75);
    });

    test("should handle 100% score", async () => {
      const sub = new Submission({
        examId,
        studentId,
        score: 50,
        maxScore: 50,
      });
      await sub.save();
      expect(sub.percentage).toBe(100);
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────
  describe("Error Handling: Required fields and validation", () => {
    test("should fail without examId", async () => {
      await expect(
        Submission.create({ studentId })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

  });
});
