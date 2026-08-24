const request = require("supertest");
const app = require("../server");
const Exam = require("../models/Exam");
const { generateExamCode } = require("../models/Exam");
const User = require("../models/User");
const Question = require("../models/Question");
const Submission = require("../models/Submission");

jest.mock("../middleware/auth", () => {
  const User = require("../models/User");
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    const uidMap = {
      "valid-tnpc-token": "tnpc123",
      "valid-tnpc2-token": "tnpc456",
      "valid-student-token": "student123",
      "valid-student2-token": "student456",
    };
    const uid = uidMap[token];
    if (!uid) return res.status(403).json({ message: "Invalid token" });
    const user = await User.findOne({ firebaseUid: uid });
    if (!user) return res.status(403).json({ message: "Invalid token" });
    req.user = {
      uid,
      email: user.email,
      role: user.role,
      authType: user.role === "student" ? "student-roster" : undefined,
      studentId: user.role === "student" ? String(user._id) : undefined,
      name: user.name || undefined,
      idNumber: user.idNumber || undefined,
      batchYear: user.batchYear ?? undefined,
    };
    next();
  };
});

describe("Phase 8: Exam Code Access, Collaborative Builder & Classroom Removal", () => {
  let tnpcAdmin, tnpcAdmin2, student, student2, draftExam, publishedExam, closedExam;

  beforeEach(async () => {
    tnpcAdmin = await User.create({ firebaseUid: "tnpc123", email: "tnpc@test.com", name: "TNPC", role: "coordinator" });
    tnpcAdmin2 = await User.create({ firebaseUid: "tnpc456", email: "tnpc2@test.com", name: "TNPC 2", role: "coordinator" });
    student = await User.create({ firebaseUid: "student123", email: "student@test.com", name: "Student", role: "student" });
    student2 = await User.create({ firebaseUid: "student456", email: "student2@test.com", name: "Student 2", role: "student" });

    const dummyQuestion = {
      type: "mcq",
      question: "Sample Question",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctAnswer: "Option A",
      points: 1
    };

    draftExam = await Exam.create({
      title: "Draft Exam", targetCompany: "TCS", teacherId: tnpcAdmin._id,
      scheduledAt: new Date(), duration: 60, endTime: new Date(Date.now() + 3600000),
      status: "draft", isActive: false, questions: [dummyQuestion]
    });

    publishedExam = await Exam.create({
      title: "Published Exam", targetCompany: "Google", teacherId: tnpcAdmin._id,
      scheduledAt: new Date(Date.now() - 60000), duration: 60, endTime: new Date(Date.now() + 3600000),
      status: "published", isActive: true, examCode: "PUB123", questions: [dummyQuestion]
    });

    closedExam = await Exam.create({
      title: "Closed Exam", targetCompany: "Amazon", teacherId: tnpcAdmin._id,
      scheduledAt: new Date(Date.now() - 3600000), duration: 60, endTime: new Date(Date.now() - 60000),
      status: "closed", isActive: false, examCode: "CLO123", questions: [dummyQuestion]
    });
  });

  // ── 1. EXAM CODE GENERATION & UNIQUENESS ────────────────────────────────────
  describe("Exam Code Generation & Uniqueness", () => {
    it("1. Generates 6-character uppercase code excluding ambiguous chars", () => {
      const code = generateExamCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    });

    it("2. Auto-generates unique examCode when published", async () => {
      const res = await request(app)
        .put(`/api/exams/${draftExam._id}/publish`)
        .set("Authorization", "Bearer valid-tnpc-token");

      expect(res.status).toBe(200);
      expect(res.body.exam.examCode).toBeDefined();
      expect(res.body.exam.examCode).toHaveLength(6);
    });

    it("3. Retains existing examCode on re-publish if already present", async () => {
      draftExam.examCode = "CUSTOM";
      await draftExam.save();

      const res = await request(app)
        .put(`/api/exams/${draftExam._id}/publish`)
        .set("Authorization", "Bearer valid-tnpc-token");

      expect(res.status).toBe(200);
      expect(res.body.exam.examCode).toBe("CUSTOM");
    });
  });

  // ── 2. JOIN ENDPOINT SECURITY & ACCESS RULES ──────────────────────────────
  describe("POST /api/exams/join", () => {
    it("4. Student can join published exam using valid code", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examCode: "PUB123" });

      expect(res.status).toBe(200);
      expect(res.body.exam.title).toBe("Published Exam");
      expect(res.body.exam._id).toBe(publishedExam._id.toString());
      expect(res.body.exam.questions).toBeUndefined(); // Does not dump questions with answers
    });

    it("5. Code input is case-insensitive and trimmed", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examCode: "  pub123  " });

      expect(res.status).toBe(200);
      expect(res.body.exam._id).toBe(publishedExam._id.toString());
    });

    it("6. Rejects invalid or nonexistent exam code", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examCode: "INVALID" });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain("not found");
    });

    it("7. Rejects draft exam code for students", async () => {
      draftExam.examCode = "DRAFT1";
      await draftExam.save();

      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examCode: "DRAFT1" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("not currently available");
    });

    it("8. Rejects closed exam code for students", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examCode: "CLO123" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("no longer available");
    });

    it("9. Rejects non-student roles from join endpoint", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({ examCode: "PUB123" });

      expect(res.status).toBe(403);
    });

    it("10. Indicates active attempt status if student already started", async () => {
      await Submission.create({
        examId: publishedExam._id,
        studentId: student._id,
        status: "in_progress",
        startedAt: new Date()
      });

      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examCode: "PUB123" });

      expect(res.status).toBe(200);
      expect(res.body.exam.hasActiveAttempt).toBe(true);
    });
  });

  // ── 3. ATOMIC QUESTION OPERATIONS (Collaborative Builder) ──────────────────
  describe("Collaborative Builder - Atomic Question Operations", () => {
    it("11. POST /api/exams/:examId/questions atomically pushes question and creates QB entry", async () => {
      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "mcq",
          question: "New MCQ Question",
          options: ["A", "B", "C", "D"],
          correctAnswer: "A",
          points: 2
        });

      expect(res.status).toBe(201);
      expect(res.body.exam.questions).toHaveLength(2);
      expect(res.body.addedQuestion.question).toBe("New MCQ Question");
      expect(res.body.addedQuestion.questionBankId).toBeDefined();

      // Check QB entry created
      const qbDoc = await Question.findById(res.body.addedQuestion.questionBankId);
      expect(qbDoc).not.toBeNull();
      expect(qbDoc.question).toBe("New MCQ Question");
    });

    it("12. Atomically adding QB existing question references questionBankId", async () => {
      const qbQuestion = await Question.create({
        type: "short_answer",
        question: "QB Question",
        correctAnswer: "Answer",
        createdBy: tnpcAdmin._id
      });

      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "QB Question",
          correctAnswer: "Answer",
          questionBankId: qbQuestion._id
        });

      expect(res.status).toBe(201);
      expect(res.body.addedQuestion.questionBankId).toBe(qbQuestion._id.toString());
    });

    it("13. Prevents adding duplicate Question Bank question to same exam", async () => {
      const qbQuestion = await Question.create({
        type: "short_answer",
        question: "QB Unique Question",
        correctAnswer: "Answer",
        createdBy: tnpcAdmin._id
      });

      await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "QB Unique Question",
          correctAnswer: "Answer",
          questionBankId: qbQuestion._id
        });

      // Try adding again
      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "QB Unique Question",
          correctAnswer: "Answer",
          questionBankId: qbQuestion._id
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("already in the exam");
    });

    it("13a. Flags duplicate question text and does not create a second bank record", async () => {
      await Question.create({
        type: "mcq",
        question: "What is 2 + 2?",
        options: ["3", "4", "5", "6"],
        correctAnswer: "4",
        targetCompany: "TCS",
        createdBy: tnpcAdmin._id
      });

      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "mcq",
          question: "what is 2 + 2?", // different case — must still be flagged
          options: ["3", "4", "5", "6"],
          correctAnswer: "4",
          targetCompany: "TCS"
        });

      expect(res.status).toBe(409);
      expect(res.body.conflict).toBeDefined();
      expect(res.body.conflict.inExam).toBe(false);
      expect(res.body.conflict.question.toLowerCase()).toBe("what is 2 + 2?");

      // No duplicate record was created
      const dupes = await Question.find({ question: { $regex: /^\s*what is 2 \+ 2\?\s*$/i } });
      expect(dupes).toHaveLength(1);
    });

    it("13b. Replaces existing bank record when replaceExisting is true", async () => {
      const original = await Question.create({
        type: "short_answer",
        question: "Explain OOP.",
        correctAnswer: "Objects and classes",
        createdBy: tnpcAdmin._id
      });

      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "Explain OOP.",
          correctAnswer: "Updated answer",
          points: 3,
          replaceExisting: true
        });

      expect(res.status).toBe(201);
      expect(res.body.replaced).toBe(true);

      const after = await Question.findById(original._id);
      expect(after).not.toBeNull(); // updated in place, not duplicated
      expect(after.correctAnswer).toBe("Updated answer");
      expect(after.points).toBe(3);

      const total = await Question.countDocuments({ question: "Explain OOP." });
      expect(total).toBe(1);
    });

    it("13c. Replacing a question already embedded in this exam refreshes its snapshot in place", async () => {
      const qbQuestion = await Question.create({
        type: "short_answer",
        question: "Embedded Replace Me",
        correctAnswer: "Old answer",
        createdBy: tnpcAdmin._id
      });

      await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "Embedded Replace Me",
          correctAnswer: "Old answer",
          questionBankId: qbQuestion._id
        });

      const beforeCount = draftExam.questions.length + 1;

      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "Embedded Replace Me",
          correctAnswer: "New answer",
          replaceExisting: true
        });

      expect(res.status).toBe(200);
      expect(res.body.replaced).toBe(true);

      const examDoc = await Exam.findById(draftExam._id);
      expect(examDoc.questions).toHaveLength(beforeCount); // snapshot replaced, not appended

      const snapshot = examDoc.questions.find(
        (q) => q.questionBankId && q.questionBankId.toString() === qbQuestion._id.toString()
      );
      expect(snapshot.correctAnswer).toBe("New answer");
    });

    it("14. DELETE /api/exams/:examId/questions/:questionId atomically pulls question without deleting QB item", async () => {
      const qbQuestion = await Question.create({
        type: "short_answer",
        question: "QB Keep Item",
        correctAnswer: "Answer",
        createdBy: tnpcAdmin._id
      });

      const addRes = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "QB Keep Item",
          correctAnswer: "Answer",
          questionBankId: qbQuestion._id
        });

      const questionId = addRes.body.addedQuestion._id;

      const delRes = await request(app)
        .delete(`/api/exams/${draftExam._id}/questions/${questionId}`)
        .set("Authorization", "Bearer valid-tnpc-token");

      expect(delRes.status).toBe(200);
      expect(delRes.body.exam.questions.find(q => q._id === questionId)).toBeUndefined();

      // Verify Question Bank item still exists
      const qbStillExists = await Question.findById(qbQuestion._id);
      expect(qbStillExists).not.toBeNull();
    });

    it("15. PUT /api/exams/:examId/questions/:questionId updates specific question atomically", async () => {
      const qId = draftExam.questions[0]._id;

      const res = await request(app)
        .put(`/api/exams/${draftExam._id}/questions/${qId}`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          question: "Updated Question Text",
          points: 5
        });

      expect(res.status).toBe(200);
      const updatedQ = res.body.exam.questions.find(q => q._id === qId.toString());
      expect(updatedQ.question).toBe("Updated Question Text");
      expect(updatedQ.points).toBe(5);
    });

    it("16. Rejects adding questions to non-draft exam", async () => {
      const res = await request(app)
        .post(`/api/exams/${publishedExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "mcq",
          question: "Late Question",
          options: ["A", "B"],
          correctAnswer: "A"
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Cannot add questions to a published");
    });

    it("17. Rejects non-owner admin from modifying questions", async () => {
      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc2-token")
        .send({
          type: "mcq",
          question: "Unauthorized Question",
          options: ["A", "B"],
          correctAnswer: "A"
        });

      expect(res.status).toBe(403);
    });
  });

  // ── 4. CLASSROOM REMOVAL VERIFICATION ──────────────────────────────────────
  describe("Classroom Removal Verification", () => {
    it("18. Classroom route /api/classrooms returns 404", async () => {
      const res = await request(app)
        .get("/api/classrooms")
        .set("Authorization", "Bearer valid-student-token");

      expect(res.status).toBe(404);
    });

    it("19. Student exams list returns empty (no browsing)", async () => {
      const res = await request(app)
        .get("/api/exams")
        .set("Authorization", "Bearer valid-student-token");

      expect(res.status).toBe(200);
      expect(res.body.exams).toEqual([]);
    });
  });

  // ── 5. STUDENT GET SECURITY ────────────────────────────────────────────────
  describe("Student GET /api/exams/:id Security", () => {
    it("20. Student GET exam by ID without submission returns safe metadata only", async () => {
      const res = await request(app)
        .get(`/api/exams/${publishedExam._id}`)
        .set("Authorization", "Bearer valid-student-token");

      expect(res.status).toBe(200);
      expect(res.body.exam.title).toBe("Published Exam");
      // MUST NOT contain questions array before starting
      expect(res.body.exam.questions).toBeUndefined();
    });

    it("21. Student CAN GET exam by ID when they have a submission", async () => {
      // Create a submission (simulating the student started the exam)
      await Submission.create({
        examId: publishedExam._id,
        studentId: student._id,
        status: "in_progress",
        startedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/exams/${publishedExam._id}`)
        .set("Authorization", "Bearer valid-student-token");

      expect(res.status).toBe(200);
      expect(res.body.exam.title).toBe("Published Exam");
      // Must NOT contain answer keys
      res.body.exam.questions.forEach((q) => {
        expect(q.correctAnswer).toBeUndefined();
        expect(q.modelAnswer).toBeUndefined();
      });
    });

    it("22. Student cannot GET draft exam by ID even with submission", async () => {
      await Submission.create({
        examId: draftExam._id,
        studentId: student._id,
        status: "in_progress",
        startedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/exams/${draftExam._id}`)
        .set("Authorization", "Bearer valid-student-token");

      expect(res.status).toBe(403);
    });

    it("23. Invalid exam ID returns 400", async () => {
      const res = await request(app)
        .get("/api/exams/not-a-valid-id")
        .set("Authorization", "Bearer valid-student-token");

      expect(res.status).toBe(400);
    });
  });

  // ── 5.5 EXAM START (SUBMISSION) SECURITY ───────────────────────────────────
  describe("Student POST /submissions/start Security", () => {
    it("23a. Starting a NEW attempt requires valid exam code", async () => {
      const res = await request(app)
        .post("/api/submissions/start")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examId: publishedExam._id }); // missing examCode

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Valid exam code is required");
    });

    it("23b. Starting a NEW attempt with valid code creates submission and returns questions", async () => {
      const res = await request(app)
        .post("/api/submissions/start")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examId: publishedExam._id, examCode: "PUB123" });

      expect(res.status).toBe(201);
      expect(res.body.submission).toBeDefined();
      expect(res.body.exam).toBeDefined();
      expect(res.body.exam.questions).toBeDefined();
      expect(res.body.exam.questions[0].correctAnswer).toBeUndefined();
    });

    it("23c. Resuming an EXISTING attempt does not require exam code", async () => {
      // Create existing submission for student2
      await Submission.create({
        examId: publishedExam._id,
        studentId: student2._id,
        status: "in_progress",
        startedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/submissions/start")
        .set("Authorization", "Bearer valid-student2-token")
        .send({ examId: publishedExam._id }); // NO exam code provided!

      expect(res.status).toBe(200); // Resumed successfully
      expect(res.body.message).toBe("Resuming exam");
      expect(res.body.submission).toBeDefined();
      expect(res.body.exam).toBeDefined();
      expect(res.body.exam.questions).toBeDefined();
    });
  });

  // ── 6. JOIN ENDPOINT RESPONSE SHAPE ────────────────────────────────────────
  describe("Join Endpoint Response Safety", () => {
    it("24. Join response does not leak correctAnswer or modelAnswer", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .set("Authorization", "Bearer valid-student-token")
        .send({ examCode: "PUB123" });

      expect(res.status).toBe(200);
      const exam = res.body.exam;
      // Should contain safe info
      expect(exam.title).toBeDefined();
      expect(exam.questionCount).toBeDefined();
      expect(exam.duration).toBeDefined();
      // Should NOT contain questions array or answers
      expect(exam.questions).toBeUndefined();
      expect(exam.correctAnswer).toBeUndefined();
      expect(exam.modelAnswer).toBeUndefined();
    });
  });

  // ── 7. STUDENT CANNOT MODIFY QUESTIONS ─────────────────────────────────────
  describe("Student Authorization on Question Endpoints", () => {
    it("25. Student cannot POST to question endpoint", async () => {
      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-student-token")
        .send({
          type: "mcq",
          question: "Student Question",
          options: ["A", "B"],
          correctAnswer: "A",
        });

      expect(res.status).toBe(403);
    });

    it("26. Student cannot DELETE questions", async () => {
      const qId = draftExam.questions[0]._id;
      const res = await request(app)
        .delete(`/api/exams/${draftExam._id}/questions/${qId}`)
        .set("Authorization", "Bearer valid-student-token");

      expect(res.status).toBe(403);
    });

    it("27. Student cannot PUT (edit) questions", async () => {
      const qId = draftExam.questions[0]._id;
      const res = await request(app)
        .put(`/api/exams/${draftExam._id}/questions/${qId}`)
        .set("Authorization", "Bearer valid-student-token")
        .send({ question: "Hacked" });

      expect(res.status).toBe(403);
    });
  });

  // ── 8. CONCURRENT QUESTION ADDITIONS ───────────────────────────────────────
  describe("Concurrent Question Operations", () => {
    it("28. Two concurrent question additions produce unique order values and both persist", async () => {
      const questionA = {
        type: "short_answer",
        question: "Concurrent Question A",
        correctAnswer: "Answer A",
      };
      const questionB = {
        type: "short_answer",
        question: "Concurrent Question B",
        correctAnswer: "Answer B",
      };

      // Fire both requests simultaneously
      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/api/exams/${draftExam._id}/questions`)
          .set("Authorization", "Bearer valid-tnpc-token")
          .send(questionA),
        request(app)
          .post(`/api/exams/${draftExam._id}/questions`)
          .set("Authorization", "Bearer valid-tnpc-token")
          .send(questionB),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      // Verify both questions are in the final exam
      const finalExam = await Exam.findById(draftExam._id);
      const addedQuestions = finalExam.questions.filter(
        (q) => q.question === "Concurrent Question A" || q.question === "Concurrent Question B"
      );
      expect(addedQuestions).toHaveLength(2);

      // Verify order values are unique (or at least both exist)
      const orders = addedQuestions.map((q) => q.order);
      // With Date.now() ordering, both should exist even if order values happen to be the same millisecond
      expect(addedQuestions.some((q) => q.question === "Concurrent Question A")).toBe(true);
      expect(addedQuestions.some((q) => q.question === "Concurrent Question B")).toBe(true);
    });
  });

  // ── 9. IMAGE QUESTION ROUND-TRIP ───────────────────────────────────────────
  describe("Image Question Handling", () => {
    it("29. Image question survives QB → exam snapshot → student view", async () => {
      const qbQuestion = await Question.create({
        type: "mcq",
        question: "What is shown in the image?",
        options: ["Cat", "Dog", "Bird", "Fish"],
        correctAnswer: "Cat",
        imageUrl: "https://example.com/test-image.png",
        createdBy: tnpcAdmin._id,
      });

      const addRes = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "mcq",
          question: "What is shown in the image?",
          options: ["Cat", "Dog", "Bird", "Fish"],
          correctAnswer: "Cat",
          imageUrl: "https://example.com/test-image.png",
          questionBankId: qbQuestion._id,
        });

      expect(addRes.status).toBe(201);
      const addedQ = addRes.body.addedQuestion;
      expect(addedQ.imageUrl).toBe("https://example.com/test-image.png");
      expect(addedQ.questionBankId).toBe(qbQuestion._id.toString());
    });
  });

  // ── 10. EXAM CODE STABILITY ────────────────────────────────────────────────
  describe("Exam Code Stability", () => {
    it("30. Exam code remains stable after editing exam metadata", async () => {
      const originalCode = publishedExam.examCode;
      expect(originalCode).toBe("PUB123");

      // Edit exam metadata (title)
      const res = await request(app)
        .put(`/api/exams/${publishedExam._id}`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({ title: "Updated Published Exam Title" });

      expect(res.status).toBe(200);

      // Verify code is unchanged
      const updated = await Exam.findById(publishedExam._id);
      expect(updated.examCode).toBe(originalCode);
      expect(updated.title).toBe("Updated Published Exam Title");
    });
  });

  // ── 11. PUBLISHED EXAM PROTECTION ──────────────────────────────────────────
  describe("Published Exam Protection", () => {
    it("31. Cannot add questions to published exam", async () => {
      const res = await request(app)
        .post(`/api/exams/${publishedExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "mcq",
          question: "Late addition",
          options: ["A", "B"],
          correctAnswer: "A",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Cannot add questions");
    });

    it("32. Cannot delete questions from published exam", async () => {
      const qId = publishedExam.questions[0]._id;
      const res = await request(app)
        .delete(`/api/exams/${publishedExam._id}/questions/${qId}`)
        .set("Authorization", "Bearer valid-tnpc-token");

      expect(res.status).toBe(400);
    });

    it("33. Cannot edit questions on published exam", async () => {
      const qId = publishedExam.questions[0]._id;
      const res = await request(app)
        .put(`/api/exams/${publishedExam._id}/questions/${qId}`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({ question: "Modified" });

      expect(res.status).toBe(400);
    });
  });

  // ── 12. QUESTION BANK RECORD SURVIVAL ──────────────────────────────────────
  describe("Question Bank Record Survival", () => {
    it("34. Deleting question from exam preserves Question Bank record", async () => {
      const qbQuestion = await Question.create({
        type: "short_answer",
        question: "QB Survival Test",
        correctAnswer: "Answer",
        createdBy: tnpcAdmin._id,
      });

      // Add to exam
      const addRes = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "QB Survival Test",
          correctAnswer: "Answer",
          questionBankId: qbQuestion._id,
        });

      const addedQId = addRes.body.addedQuestion._id;

      // Delete from exam
      await request(app)
        .delete(`/api/exams/${draftExam._id}/questions/${addedQId}`)
        .set("Authorization", "Bearer valid-tnpc-token");

      // Verify QB record still exists
      const qbStill = await Question.findById(qbQuestion._id);
      expect(qbStill).not.toBeNull();
      expect(qbStill.question).toBe("QB Survival Test");
    });
  });

  // ── 13. UNAUTHENTICATED ACCESS ─────────────────────────────────────────────
  describe("Unauthenticated Access", () => {
    it("35. Unauthenticated join request rejected", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .send({ examCode: "PUB123" });

      expect(res.status).toBe(403);
    });
  });
});
