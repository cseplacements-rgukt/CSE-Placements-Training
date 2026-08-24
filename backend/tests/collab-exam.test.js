const request = require("supertest");
const app = require("../server");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Question = require("../models/Question");

jest.mock("../middleware/auth", () => (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token === "valid-tnpc-token") req.user = { uid: "tnpc123" };
  else if (token === "valid-tnpc2-token") req.user = { uid: "tnpc456" };
  else if (token === "valid-tnpc3-token") req.user = { uid: "tnpc789" };
  else if (token === "valid-student-token") req.user = { uid: "student123" };
  else return res.status(403).json({ message: "Invalid token" });
  next();
});

describe("Collaborative Exam Creation Workflow", () => {
  let creator, contributor, outsider, student, shell;

  beforeEach(async () => {
    creator = await User.create({ firebaseUid: "tnpc123", email: "creator@test.com", name: "Creator One", role: "coordinator" });
    contributor = await User.create({ firebaseUid: "tnpc456", email: "contributor@test.com", name: "Contributor Two", role: "coordinator" });
    outsider = await User.create({ firebaseUid: "tnpc789", email: "outsider@test.com", name: "Outsider Three", role: "coordinator" });
    student = await User.create({ firebaseUid: "student123", email: "student@test.com", name: "Student", role: "student" });
  });

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  // ── 1. SHELL CREATION ───────────────────────────────────────────────────────
  describe("Shell creation without timing", () => {
    it("1. Creates a draft shell with just a title (no timing required)", async () => {
      const res = await request(app)
        .post("/api/exams")
        .set(auth("valid-tnpc-token"))
        .send({ title: "Gridlex Mock Test 1", examCategory: "Aptitude" });

      expect(res.status).toBe(201);
      expect(res.body.exam.status).toBe("draft");
      expect(res.body.exam.scheduledAt).toBeNull();
      expect(res.body.exam.duration).toBeNull();
      expect(res.body.exam.endTime).toBeNull();
      expect(res.body.exam.teacherId).toBe(creator._id.toString());
      expect(res.body.exam.collaborators).toHaveLength(1);
      expect(res.body.exam.collaborators[0].role).toBe("creator");
      expect(res.body.exam.collaborators[0].userId.toString()).toBe(creator._id.toString());
    });

    it("2. Rejects shell creation without a title", async () => {
      const res = await request(app)
        .post("/api/exams")
        .set(auth("valid-tnpc-token"))
        .send({ examCategory: "Aptitude" });

      expect(res.status).toBe(400);
    });

    it("3. Students cannot create shells", async () => {
      const res = await request(app)
        .post("/api/exams")
        .set(auth("valid-student-token"))
        .send({ title: "Sneaky" });

      expect(res.status).toBe(403);
    });
  });

  // ── 2. TEAM VISIBILITY ─────────────────────────────────────────────────────
  describe("Shared team drafts visibility", () => {
    beforeEach(async () => {
      shell = await Exam.create({
        title: "Gridlex Mock Test 1",
        teacherId: creator._id,
        status: "draft",
        questions: [],
      });
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      await shell.save();
    });

    it("4. Creator sees the draft in their list", async () => {
      const res = await request(app).get("/api/exams").set(auth("valid-tnpc-token"));
      expect(res.status).toBe(200);
      expect(res.body.exams.some((e) => e._id === shell._id.toString())).toBe(true);
    });

    it("5. Contributor sees the shared draft in their list", async () => {
      const res = await request(app).get("/api/exams").set(auth("valid-tnpc2-token"));
      expect(res.status).toBe(200);
      expect(res.body.exams.some((e) => e._id === shell._id.toString())).toBe(true);
    });

    it("6. Outsider admin does NOT see someone else's draft in their list", async () => {
      const res = await request(app).get("/api/exams").set(auth("valid-tnpc3-token"));
      expect(res.status).toBe(200);
      expect(res.body.exams.some((e) => e._id === shell._id.toString())).toBe(false);
    });

    it("7. GET /drafts returns shared drafts with populated collaborator names", async () => {
      const res = await request(app).get("/api/exams/drafts").set(auth("valid-tnpc2-token"));
      expect(res.status).toBe(200);
      const draft = res.body.exams.find((e) => e._id === shell._id.toString());
      expect(draft).toBeDefined();
      const contribEntry = draft.collaborators.find((c) => c.role === "contributor");
      expect(contribEntry.name).toBe("Contributor Two");
    });

    it("8. GET /drafts excludes published exams", async () => {
      shell.status = "published";
      shell.isActive = true;
      shell.scheduledAt = new Date();
      shell.duration = 60;
      shell.endTime = new Date(Date.now() + 3600000);
      shell.examCode = "GRID01";
      await shell.save();

      const res = await request(app).get("/api/exams/drafts").set(auth("valid-tnpc2-token"));
      expect(res.body.exams.some((e) => e._id === shell._id.toString())).toBe(false);
    });
  });

  // ── 3. COLLABORATOR MANAGEMENT ─────────────────────────────────────────────
  describe("Collaborator management", () => {
    beforeEach(async () => {
      shell = await Exam.create({
        title: "Gridlex Mock Test 1",
        teacherId: creator._id,
        status: "draft",
        questions: [],
      });
    });

    it("9. Creator adds a contributor by email", async () => {
      const res = await request(app)
        .post(`/api/exams/${shell._id}/collaborators`)
        .set(auth("valid-tnpc-token"))
        .send({ email: "CONTRIBUTOR@test.com" });

      expect(res.status).toBe(200);
      expect(res.body.exam.collaborators).toHaveLength(2);
      const entry = res.body.exam.collaborators.find((c) => c.role === "contributor");
      expect(entry.userId.toString()).toBe(contributor._id.toString());
    });

    it("10. Rejects students as collaborators", async () => {
      const res = await request(app)
        .post(`/api/exams/${shell._id}/collaborators`)
        .set(auth("valid-tnpc-token"))
        .send({ email: "student@test.com" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("coordinator tier");
    });

    it("11. Rejects duplicate collaborators", async () => {
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      await shell.save();

      const res = await request(app)
        .post(`/api/exams/${shell._id}/collaborators`)
        .set(auth("valid-tnpc-token"))
        .send({ email: "contributor@test.com" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("already on this exam");
    });

    it("12. Only the creator can remove a collaborator", async () => {
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      shell.collaborators.push({ userId: outsider._id, role: "contributor" });
      await shell.save();

      const res = await request(app)
        .delete(`/api/exams/${shell._id}/collaborators/${outsider._id}`)
        .set(auth("valid-tnpc2-token"));

      expect(res.status).toBe(403);
    });

    it("13. Creator removes a contributor; the creator themselves cannot be removed", async () => {
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      await shell.save();

      const delRes = await request(app)
        .delete(`/api/exams/${shell._id}/collaborators/${contributor._id}`)
        .set(auth("valid-tnpc-token"));
      expect(delRes.status).toBe(200);

      const selfRes = await request(app)
        .delete(`/api/exams/${shell._id}/collaborators/${creator._id}`)
        .set(auth("valid-tnpc-token"));
      expect(selfRes.status).toBe(400);
    });
  });

  // ── 4. PARALLEL QUESTION ADDING ────────────────────────────────────────────
  describe("Parallel editing without clobbering", () => {
    beforeEach(async () => {
      shell = await Exam.create({
        title: "Gridlex Mock Test 1",
        teacherId: creator._id,
        status: "draft",
        questions: [],
      });
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      await shell.save();
    });

    it("14. Contributor can atomically add a question to the shared draft", async () => {
      const res = await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc2-token"))
        .send({
          type: "mcq",
          question: "Speed question by contributor",
          options: ["10 km/h", "20 km/h"],
          correctAnswer: "20 km/h",
          points: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.addedQuestion.createdBy).toBe(contributor._id.toString());
      expect(res.body.addedQuestion.createdByName).toBe("Contributor Two");
    });

    it("15. Two members adding simultaneously both persist (no last-write-wins)", async () => {
      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/api/exams/${shell._id}/questions`)
          .set(auth("valid-tnpc-token"))
          .send({ type: "short_answer", question: "Creator's parallel Q", correctAnswer: "A1" }),
        request(app)
          .post(`/api/exams/${shell._id}/questions`)
          .set(auth("valid-tnpc2-token"))
          .send({ type: "short_answer", question: "Contributor's parallel Q", correctAnswer: "A2" }),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      const finalExam = await Exam.findById(shell._id);
      expect(finalExam.questions).toHaveLength(2);
      expect(finalExam.questions.map((q) => q.question).sort()).toEqual([
        "Contributor's parallel Q",
        "Creator's parallel Q",
      ]);
    });

    it("16. Metadata PUT does not wipe concurrent questions (no whole-array replacement)", async () => {
      await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc2-token"))
        .send({ type: "short_answer", question: "Survives metadata save", correctAnswer: "X" });

      const res = await request(app)
        .put(`/api/exams/${shell._id}`)
        .set(auth("valid-tnpc-token"))
        .send({ title: "Renamed while others work", description: "updated" });

      expect(res.status).toBe(200);
      const finalExam = await Exam.findById(shell._id);
      expect(finalExam.title).toBe("Renamed while others work");
      expect(finalExam.questions).toHaveLength(1);
    });

    it("17. Outsider admin cannot add questions to a draft they are not on", async () => {
      const res = await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc3-token"))
        .send({ type: "mcq", question: "Sneaky Q", options: ["a", "b"], correctAnswer: "a" });

      expect(res.status).toBe(403);
    });
  });

  // ── 5. SECTIONS ────────────────────────────────────────────────────────────
  describe("Sections (incl. difficulty buckets)", () => {
    beforeEach(async () => {
      shell = await Exam.create({
        title: "Gridlex Mock Test 1",
        teacherId: creator._id,
        status: "draft",
        questions: [],
      });
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      await shell.save();
    });

    it("18. Collaborator creates a difficulty-bucket section", async () => {
      const res = await request(app)
        .post(`/api/exams/${shell._id}/sections`)
        .set(auth("valid-tnpc2-token"))
        .send({ name: "Medium" });

      expect(res.status).toBe(201);
      expect(res.body.section.name).toBe("Medium");
      expect(res.body.section.ownerIds[0].toString()).toBe(contributor._id.toString());
    });

    it("19. Rejects duplicate section names (case-insensitive)", async () => {
      await request(app)
        .post(`/api/exams/${shell._id}/sections`)
        .set(auth("valid-tnpc-token"))
        .send({ name: "Speed and Time" });

      const res = await request(app)
        .post(`/api/exams/${shell._id}/sections`)
        .set(auth("valid-tnpc2-token"))
        .send({ name: "speed AND time" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("already exists");
    });

    it("20. Questions added to a section carry its sectionId; deleting the section ungroups them", async () => {
      const secRes = await request(app)
        .post(`/api/exams/${shell._id}/sections`)
        .set(auth("valid-tnpc-token"))
        .send({ name: "Easy" });
      const sectionId = secRes.body.section._id;

      const qRes = await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc-token"))
        .send({
          type: "mcq",
          question: "Easy peasy",
          options: ["1", "2"],
          correctAnswer: "1",
          sectionId,
        });
      expect(qRes.status).toBe(201);
      expect(qRes.body.addedQuestion.sectionId).toBe(sectionId);

      const putRes = await request(app)
        .put(`/api/exams/${shell._id}/sections/${sectionId}`)
        .set(auth("valid-tnpc2-token"))
        .send({ name: "Warm-up" });
      expect(putRes.status).toBe(200);

      const delRes = await request(app)
        .delete(`/api/exams/${shell._id}/sections/${sectionId}`)
        .set(auth("valid-tnpc-token"));
      expect(delRes.status).toBe(200);

      const finalExam = await Exam.findById(shell._id);
      expect(finalExam.sections).toHaveLength(0);
      expect(finalExam.questions).toHaveLength(1);
      expect(finalExam.questions[0].sectionId).toBeNull();
    });

    it("21. Rejects questions referencing a foreign sectionId", async () => {
      const other = await Exam.create({
        title: "Other Exam",
        teacherId: creator._id,
        status: "draft",
        sections: [{ name: "Ghost" }],
        questions: [],
      });

      const res = await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc-token"))
        .send({
          type: "short_answer",
          question: "Misfiled Q",
          correctAnswer: "Y",
          sectionId: other.sections[0]._id,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Section not found");
    });
  });

  // ── 6. RICH CONTENT ROUND-TRIP ─────────────────────────────────────────────
  describe("Rich question content (code/KaTeX)", () => {
    beforeEach(async () => {
      shell = await Exam.create({
        title: "Gridlex Mock Test 1",
        teacherId: creator._id,
        status: "draft",
        questions: [],
      });
    });

    it("22. Code question persists contentType and codeSnippet", async () => {
      const res = await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc-token"))
        .send({
          type: "mcq",
          contentType: "code",
          codeSnippet: { code: "console.log(2 + 2)", language: "javascript" },
          question: "What is the output of $2+2$ here?",
          options: ["4", "5"],
          correctAnswer: "4",
        });

      expect(res.status).toBe(201);
      expect(res.body.addedQuestion.contentType).toBe("code");
      expect(res.body.addedQuestion.codeSnippet.language).toBe("javascript");

      const qbDoc = await Question.findById(res.body.addedQuestion.questionBankId);
      expect(qbDoc.contentType).toBe("code");
      expect(qbDoc.codeSnippet.code).toBe("console.log(2 + 2)");
    });
  });

  // ── 7. STATUS LIFECYCLE & REVIEW VIEW ──────────────────────────────────────
  describe("Status lifecycle and consolidated review", () => {
    beforeEach(async () => {
      shell = await Exam.create({
        title: "Gridlex Mock Test 1",
        teacherId: creator._id,
        status: "draft",
        questions: [],
        sections: [{ name: "Quant" }],
      });
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      await shell.save();

      await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc-token"))
        .send({
          type: "short_answer",
          question: "Creator Q",
          correctAnswer: "C1",
          points: 3,
          sectionId: shell.sections[0]._id,
        });
      await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc2-token"))
        .send({ type: "short_answer", question: "Contributor Q", correctAnswer: "C2", points: 5 });
    });

    it("23. Creator submits for review; contributors can reopen", async () => {
      const subRes = await request(app)
        .put(`/api/exams/${shell._id}/status`)
        .set(auth("valid-tnpc-token"))
        .send({ status: "ready_for_review" });
      expect(subRes.status).toBe(200);
      expect(subRes.body.exam.status).toBe("ready_for_review");
      expect(subRes.body.exam.submittedForReviewAt).toBeDefined();

      // Still editable while ready_for_review
      const addRes = await request(app)
        .post(`/api/exams/${shell._id}/questions`)
        .set(auth("valid-tnpc2-token"))
        .send({ type: "short_answer", question: "Late addition still allowed", correctAnswer: "L" });
      expect(addRes.status).toBe(201);

      const reopenRes = await request(app)
        .put(`/api/exams/${shell._id}/status`)
        .set(auth("valid-tnpc2-token"))
        .send({ status: "draft" });
      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.exam.status).toBe("draft");
    });

    it("24. Contributor cannot submit for review; outsiders cannot touch status", async () => {
      const res = await request(app)
        .put(`/api/exams/${shell._id}/status`)
        .set(auth("valid-tnpc2-token"))
        .send({ status: "ready_for_review" });
      expect(res.status).toBe(403);

      const res2 = await request(app)
        .put(`/api/exams/${shell._id}/status`)
        .set(auth("valid-tnpc3-token"))
        .send({ status: "draft" });
      expect(res2.status).toBe(403);
    });

    it("25. Consolidated review groups by section and author with stats", async () => {
      const res = await request(app)
        .get(`/api/exams/${shell._id}/review`)
        .set(auth("valid-tnpc-token"));

      expect(res.status).toBe(200);
      expect(res.body.stats.totalQuestions).toBe(2);
      expect(res.body.stats.totalPoints).toBe(8);

      const quant = res.body.sections.find((s) => s.name === "Quant");
      expect(quant.questions).toHaveLength(1);
      expect(quant.questions[0].question).toBe("Creator Q");

      expect(res.body.ungrouped).toHaveLength(1);
      expect(res.body.ungrouped[0].question).toBe("Contributor Q");

      const authorNames = res.body.stats.authors.map((a) => a.name).sort();
      expect(authorNames).toEqual(["Contributor Two", "Creator One"]);
      const contributorStats = res.body.stats.authors.find((a) => a.name === "Contributor Two");
      expect(contributorStats.count).toBe(1);
      expect(contributorStats.points).toBe(5);
    });

    it("26. Outsider cannot fetch the review view", async () => {
      const res = await request(app)
        .get(`/api/exams/${shell._id}/review`)
        .set(auth("valid-tnpc3-token"));
      expect(res.status).toBe(403);
    });
  });

  // ── 8. PUBLISH REQUIRES TIMING ─────────────────────────────────────────────
  describe("Publish enforces timing", () => {
    beforeEach(async () => {
      shell = await Exam.create({
        title: "Gridlex Mock Test 1",
        teacherId: creator._id,
        status: "draft",
        questions: [{
          type: "mcq", question: "Q?", options: ["a", "b"], correctAnswer: "a", points: 1,
        }],
      });
      shell.collaborators.push({ userId: contributor._id, role: "contributor" });
      await shell.save();
    });

    it("27. Publishing a timing-less draft fails with actionable errors", async () => {
      const res = await request(app)
        .put(`/api/exams/${shell._id}/publish`)
        .set(auth("valid-tnpc-token"));

      expect(res.status).toBe(400);
      expect(res.body.errors.some((e) => e.toLowerCase().includes("date"))).toBe(true);
      expect(res.body.errors.some((e) => e.toLowerCase().includes("duration"))).toBe(true);
    });

    it("28. Publishing with body timing persists schedule, endTime, code, and status", async () => {
      const when = new Date(Date.now() + 24 * 3600000);
      const res = await request(app)
        .put(`/api/exams/${shell._id}/publish`)
        .set(auth("valid-tnpc-token"))
        .send({ scheduledAt: when.toISOString(), duration: 90 });

      expect(res.status).toBe(200);
      expect(res.body.exam.status).toBe("published");
      expect(res.body.exam.examCode).toBeDefined();
      expect(res.body.exam.duration).toBe(90);
      expect(new Date(res.body.exam.scheduledAt).getTime()).toBe(when.getTime());
      expect(new Date(res.body.exam.endTime).getTime()).toBe(when.getTime() + 90 * 60000);
      expect(res.body.exam.isActive).toBe(true);
    });

    it("29. Contributor cannot publish; only the creator or platform admin", async () => {
      const when = new Date(Date.now() + 24 * 3600000);
      const res = await request(app)
        .put(`/api/exams/${shell._id}/publish`)
        .set(auth("valid-tnpc2-token"))
        .send({ scheduledAt: when.toISOString(), duration: 60 });

      expect(res.status).toBe(403);
    });

    it("30. Published exams reject further question edits", async () => {
      const when = new Date(Date.now() + 24 * 3600000);
      await request(app)
        .put(`/api/exams/${shell._id}/publish`)
        .set(auth("valid-tnpc-token"))
        .send({ scheduledAt: when.toISOString(), duration: 60 });

      const qId = (await Exam.findById(shell._id)).questions[0]._id;
      const res = await request(app)
        .put(`/api/exams/${shell._id}/questions/${qId}`)
        .set(auth("valid-tnpc-token"))
        .send({ question: "Hacked?" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Cannot edit questions");
    });
  });

  // ── 9. LEGACY DRAFT BACKFILL ───────────────────────────────────────────────
  describe("Legacy single-owner drafts keep working", () => {
    it("31. Old draft with no collaborators array is manageable by its owner", async () => {
      const legacy = {
        title: "Legacy Draft",
        targetCompany: "TCS",
        teacherId: creator._id,
        scheduledAt: new Date(),
        duration: 60,
        endTime: new Date(Date.now() + 3600000),
        status: "draft",
        isActive: false,
        questions: [],
      };
      delete legacy.collaborators;
      const doc = await Exam.collection.insertOne(legacy);
      // Inserted raw so `collaborators` stays empty — simulating pre-migration data

      const res = await request(app)
        .post(`/api/exams/${doc.insertedId}/questions`)
        .set(auth("valid-tnpc-token"))
        .send({ type: "short_answer", question: "Owner still works", correctAnswer: "ok" });

      expect(res.status).toBe(201);
    });
  });

  // ── 10. STUDENT SAFETY ─────────────────────────────────────────────────────
  describe("Student safety around drafts", () => {
    it("32. Student cannot view a ready_for_review exam", async () => {
      shell = await Exam.create({
        title: "Hidden Draft",
        teacherId: creator._id,
        status: "ready_for_review",
        questions: [],
      });

      const res = await request(app)
        .get(`/api/exams/${shell._id}`)
        .set(auth("valid-student-token"));
      expect(res.status).toBe(403);
    });
  });
});
