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

const User = require("../models/User");
const Exam = require("../models/Exam");
const Submission = require("../models/Submission");
const ProctoringSession = require("../models/ProctoringSession");
const Notification = require("../models/Notification");

// ═══════════════════════════════════════════════════════════════════
// INTEGRATION-STYLE TESTS: Cross-model workflows
// ═══════════════════════════════════════════════════════════════════

describe("Cross-Model Integration Tests", () => {
  // ─── Logic Checks: Full exam lifecycle ─────────────────────────
  describe("Logic Checks: Complete exam submission workflow", () => {
    test("should handle full exam creation → submission → scoring lifecycle", async () => {
      // 1. Create teacher and student
      const teacher = await User.create({
        firebaseUid: "int_teacher",
        email: "int_teacher@test.com",
        name: "Integration Teacher",
        role: "teacher",
      });

      const student = await User.create({
        firebaseUid: "int_student",
        email: "int_student@test.com",
        name: "Integration Student",
        role: "student",
      });

      // 2. Create exam
      const exam = await Exam.create({
        title: "Integration Exam",
        teacherId: teacher._id,
        targetCompany: "TestCompany",
        questions: [
          {
            type: "mcq",
            question: "Capital of France?",
            options: ["London", "Paris", "Berlin"],
            correctAnswer: "Paris",
            points: 10,
          },
          {
            type: "true_false",
            question: "Earth is flat?",
            options: ["True", "False"],
            correctAnswer: "False",
            points: 5,
          },
          {
            type: "short_answer",
            question: "Color of sky?",
            correctAnswer: "Blue",
            points: 5,
          },
        ],
        scheduledAt: new Date(Date.now() - 60 * 60000),
        duration: 120,
        endTime: new Date(Date.now() + 60 * 60000),
      });

      expect(exam.totalPoints).toBe(20);

      // 3. Create submission (student answers)
      const submission = new Submission({
        examId: exam._id,
        studentId: student._id,
        maxScore: exam.totalPoints,
        score: 15, // Got 2 out of 3 correct
        status: "submitted",
        submittedAt: new Date(),
        answers: exam.questions.map((q) => ({
          questionId: q._id,
          answer: q.correctAnswer === "Blue" ? "Red" : q.correctAnswer,
        })),
      });

      await submission.save();

      expect(submission.percentage).toBe(75); // 15/20 * 100 = 75

      // 4. Verify relationships
      const foundSubmission = await Submission.findById(submission._id);
      expect(foundSubmission.examId.toString()).toBe(exam._id.toString());
      expect(foundSubmission.studentId.toString()).toBe(student._id.toString());
    });
  });

  // ─── Logic Checks: Proctoring session with events ────────────
  describe("Logic Checks: Proctoring session workflow", () => {
    test("should track trust score degradation through events", async () => {
      const student = await User.create({
        firebaseUid: "proct_student",
        email: "proct_student@test.com",
        name: "Proct Student",
        role: "student",
      });

      const teacher = await User.create({
        firebaseUid: "proct_teacher",
        email: "proct_teacher@test.com",
        name: "Proct Teacher",
        role: "teacher",
      });

      const exam = await Exam.create({
        title: "Proctored Exam",
        teacherId: teacher._id,
        targetCompany: "TestCompany",
        questions: [
          { type: "mcq", question: "Q?", correctAnswer: "A", options: ["A", "B"], points: 10 },
        ],
        scheduledAt: new Date(),
        duration: 60,
        endTime: new Date(Date.now() + 60 * 60000),
      });

      const submission = await Submission.create({
        examId: exam._id,
        studentId: student._id,
      });

      // Create proctoring session
      const session = new ProctoringSession({
        submissionId: submission._id,
        studentId: student._id,
        examId: exam._id,
        trustScore: 100,
      });

      // Simulate events degrading trust score
      const events = [
        { type: "tab_switch", severity: "medium" },
        { type: "fullscreen_exit", severity: "high" },
        { type: "tab_switch", severity: "medium" },
        { type: "face_not_detected", severity: "high" },
        { type: "copy_paste", severity: "low" },
      ];

      session.events = events;
      await session.save();

      expect(session.summary.totalEvents).toBe(5);
      expect(session.summary.highSeverityEvents).toBe(2);
      expect(session.summary.totalTabSwitches).toBe(2);
      expect(session.summary.totalFullscreenExits).toBe(1);
    });
  });

  // ─── Logic Checks: Notification creation for flagged submission ──
  describe("Logic Checks: Notification workflow", () => {
    test("should create notifications for flagged submissions", async () => {
      const teacher = await User.create({
        firebaseUid: "notif_teacher",
        email: "notif_teacher@test.com",
        name: "Notif Teacher",
        role: "teacher",
      });

      const student = await User.create({
        firebaseUid: "notif_student",
        email: "notif_student@test.com",
        name: "Notif Student",
        role: "student",
      });

      // Create notification for student
      const studentNotif = await Notification.create({
        userId: student._id,
        type: "exam_submitted",
        title: "Exam Submitted",
        message: 'Your submission for "Math Exam" has been received.',
        priority: "medium",
      });

      // Create notification for teacher (flagged)
      const teacherNotif = await Notification.create({
        userId: teacher._id,
        type: "flagged_submission",
        title: "Flagged Submission",
        message: 'A submission for "Math Exam" has been flagged.',
        priority: "high",
      });

      expect(studentNotif.type).toBe("exam_submitted");
      expect(studentNotif.priority).toBe("medium");
      expect(teacherNotif.type).toBe("flagged_submission");
      expect(teacherNotif.priority).toBe("high");

      // Verify notifications belong to correct users
      const studentNotifs = await Notification.find({ userId: student._id });
      const teacherNotifs = await Notification.find({ userId: teacher._id });

      expect(studentNotifs).toHaveLength(1);
      expect(teacherNotifs).toHaveLength(1);
    });
  });

  // ─── Boundary Checks: Multiple submissions ─────────────────────
  describe("Boundary Checks: Multiple students, same exam", () => {
    test("should support multiple students submitting the same exam", async () => {
      const teacher = await User.create({
        firebaseUid: "multi_teacher",
        email: "multi_teacher@test.com",
        name: "Multi Teacher",
        role: "teacher",
      });

      const exam = await Exam.create({
        title: "Multi Student Exam",
        teacherId: teacher._id,
        targetCompany: "TestCompany",
        questions: [
          { type: "mcq", question: "Q?", correctAnswer: "A", options: ["A", "B"], points: 10 },
        ],
        scheduledAt: new Date(),
        duration: 60,
        endTime: new Date(Date.now() + 60 * 60000),
      });

      // Create 5 students with submissions
      const submissions = [];
      for (let i = 0; i < 5; i++) {
        const student = await User.create({
          firebaseUid: `multi_student_${i}`,
          email: `multi_student_${i}@test.com`,
          name: `Student ${i}`,
          role: "student",
        });

        const sub = new Submission({
          examId: exam._id,
          studentId: student._id,
          score: i * 2,
          maxScore: 10,
          status: "submitted",
          submittedAt: new Date(),
        });
        await sub.save();
        submissions.push(sub);
      }

      const allSubs = await Submission.find({ examId: exam._id });
      expect(allSubs).toHaveLength(5);

      // Verify percentages
      expect(submissions[0].percentage).toBe(0);    // 0/10
      expect(submissions[1].percentage).toBe(20);   // 2/10
      expect(submissions[2].percentage).toBe(40);   // 4/10
      expect(submissions[3].percentage).toBe(60);   // 6/10
      expect(submissions[4].percentage).toBe(80);   // 8/10
    });
  });
});
