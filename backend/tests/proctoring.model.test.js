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

const ProctoringSession = require("../models/ProctoringSession");
const User = require("../models/User");
const Exam = require("../models/Exam");
const Submission = require("../models/Submission");

// ═══════════════════════════════════════════════════════════════════
// PROCTORING SESSION MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("ProctoringSession Model", () => {
  let studentId, examId, submissionId;

  beforeEach(async () => {
    const student = await User.create({
      firebaseUid: "ps_student",
      email: "ps_student@test.com",
      name: "PS Student",
      role: "student",
    });
    studentId = student._id;

    const teacher = await User.create({
      firebaseUid: "ps_teacher",
      email: "ps_teacher@test.com",
      name: "PS Teacher",
      role: "teacher",
    });

    const exam = await Exam.create({
      title: "Proctor Exam",
      teacherId: teacher._id,
      targetCompany: "TestCompany",
      questions: [
        { type: "mcq", question: "Q?", correctAnswer: "A", options: ["A", "B"], points: 5 },
      ],
      scheduledAt: new Date(),
      duration: 60,
      endTime: new Date(Date.now() + 60 * 60000),
    });
    examId = exam._id;

    const submission = await Submission.create({
      examId,
      studentId,
    });
    submissionId = submission._id;
  });

  // ─── OO Checks: Schema defaults ──────────────────────────────────
  describe("OO Checks: Schema defaults and structure", () => {
    test("should create session with required fields", async () => {
      const session = await ProctoringSession.create({
        submissionId,
        studentId,
        examId,
      });

      expect(session.submissionId.toString()).toBe(submissionId.toString());
      expect(session.studentId.toString()).toBe(studentId.toString());
      expect(session.examId.toString()).toBe(examId.toString());
    });

    test("should apply correct defaults", async () => {
      const session = await ProctoringSession.create({
        submissionId,
        studentId,
        examId,
      });

      expect(session.status).toBe("active");
      expect(session.faceDetectionEnabled).toBe(true);
      expect(session.audioMonitoringEnabled).toBe(false);
      expect(session.trustScore).toBe(100);
      expect(session.reviewStatus).toBe("pending");
      expect(session.summary.totalEvents).toBe(0);
      expect(session.summary.highSeverityEvents).toBe(0);
      expect(session.summary.averageFacesDetected).toBe(1);
      expect(session.summary.totalTabSwitches).toBe(0);
      expect(session.summary.totalFullscreenExits).toBe(0);
    });

    test("should reject invalid session status", async () => {
      await expect(
        ProctoringSession.create({
          submissionId, studentId, examId, status: "invalid",
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // ─── Logic Checks: Pre-save summary calculation ──────────────────
  describe("Logic Checks: Pre-save summary calculation", () => {
    test("should calculate totalEvents from events array", async () => {
      const session = new ProctoringSession({
        submissionId, studentId, examId,
        events: [
          { type: "tab_switch", severity: "medium" },
          { type: "fullscreen_exit", severity: "high" },
          { type: "copy_paste", severity: "low" },
        ],
      });
      await session.save();

      expect(session.summary.totalEvents).toBe(3);
    });
  });

  // ─── Error Handling ────────────────────────────────────────────────
  describe("Error Handling: Required fields", () => {
    test("should fail without submissionId", async () => {
      await expect(
        ProctoringSession.create({ studentId, examId })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });
});
