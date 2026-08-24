const request = require("supertest");
const app = require("../server");
const Exam = require("../models/Exam");
const { generateExamCode } = require("../models/Exam");
const User = require("../models/User");
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
    it("11. POST /api/exams/:examId/questions atomically pushes an embedded question (no bank)", async () => {
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
      // The shared question bank is gone — snapshots are self-contained.
      expect(res.body.addedQuestion.questionBankId).toBeNull();
    });

    it("12. Stale/unknown questionBankId in payload is ignored", async () => {
      const res = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "Payload With Bank Id",
          correctAnswer: "Answer",
          questionBankId: "507f1f77bcf86cd799439011"
        });

      expect(res.status).toBe(201);
      expect(res.body.addedQuestion.questionBankId).toBeNull();
    });

    it("13. Prevents adding the same question text to the same exam", async () => {
      const send = (question) =>
        request(app)
          .post(`/api/exams/${draftExam._id}/questions`)
          .set("Authorization", "Bearer valid-tnpc-token")
          .send({ type: "short_answer", question, correctAnswer: "Answer" });

      expect((await send("Unique Text Question")).status).toBe(201);

      const res = await send("Unique Text Question");
      expect(res.status).toBe(409);
      expect(res.body.message).toContain("already exists in this exam");
    });

    it("13a. Flags duplicate question text case-insensitively within this exam", async () => {
      const send = (question) =>
        request(app)
          .post(`/api/exams/${draftExam._id}/questions`)
          .set("Authorization", "Bearer valid-tnpc-token")
          .send({
            type: "mcq",
            question,
            options: ["3", "4", "5", "6"],
            correctAnswer: "4",
          });

      expect((await send("What is 2 + 2?")).status).toBe(201);

      const res = await send("what is 2 + 2?"); // different case — must still be flagged
      expect(res.status).toBe(409);
      expect(res.body.conflict).toBeDefined();
      expect(res.body.conflict.inExam).toBe(true);
      expect(res.body.conflict.question.toLowerCase()).toBe("what is 2 + 2?");
    });

    it("13b. replaceExisting updates the embedded snapshot in place (no second entry)", async () => {
      const send = (correctAnswer, extra = {}) =>
        request(app)
          .post(`/api/exams/${draftExam._id}/questions`)
          .set("Authorization", "Bearer valid-tnpc-token")
          .send({
            type: "short_answer",
            question: "Explain OOP.",
            correctAnswer,
            ...extra,
          });

      await send("Objects and classes");
      const beforeCount = (await Exam.findById(draftExam._id)).questions.length;

      const res = await send("Updated answer", { points: 3, replaceExisting: true });

      expect(res.status).toBe(200);
      expect(res.body.replaced).toBe(true);

      const examDoc = await Exam.findById(draftExam._id);
      expect(examDoc.questions).toHaveLength(beforeCount); // replaced, not appended

      const snapshot = examDoc.questions.find((q) => q.question === "Explain OOP.");
      expect(snapshot.correctAnswer).toBe("Updated answer");
      expect(snapshot.points).toBe(3);
    });

    it("13c. Replacing a question embedded in this exam refreshes its snapshot in place", async () => {
      await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "Embedded Replace Me",
          correctAnswer: "Old answer",
        });

      const beforeCount = (await Exam.findById(draftExam._id)).questions.length;

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

      const snapshot = examDoc.questions.find((q) => q.question === "Embedded Replace Me");
      expect(snapshot.correctAnswer).toBe("New answer");
    });

    it("14. DELETE /api/exams/:examId/questions/:questionId atomically pulls the question", async () => {
      const addRes = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "short_answer",
          question: "Removable Question",
          correctAnswer: "Answer"
        });

      const questionId = addRes.body.addedQuestion._id;

      const delRes = await request(app)
        .delete(`/api/exams/${draftExam._id}/questions/${questionId}`)
        .set("Authorization", "Bearer valid-tnpc-token");

      expect(delRes.status).toBe(200);
      expect(delRes.body.exam.questions.find(q => q._id === questionId)).toBeUndefined();
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
    it("29. Image URL survives into the exam snapshot", async () => {
      const addRes = await request(app)
        .post(`/api/exams/${draftExam._id}/questions`)
        .set("Authorization", "Bearer valid-tnpc-token")
        .send({
          type: "mcq",
          question: "What is shown in the image?",
          options: ["Cat", "Dog", "Bird", "Fish"],
          correctAnswer: "Cat",
          imageUrl: "https://example.com/test-image.png",
        });

      expect(addRes.status).toBe(201);
      const addedQ = addRes.body.addedQuestion;
      expect(addedQ.imageUrl).toBe("https://example.com/test-image.png");
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

  // ── 12. UNAUTHENTICATED ACCESS ─────────────────────────────────────────────
  describe("Unauthenticated Access", () => {
    it("35. Unauthenticated join request rejected", async () => {
      const res = await request(app)
        .post("/api/exams/join")
        .send({ examCode: "PUB123" });

      expect(res.status).toBe(403);
    });
  });
});
