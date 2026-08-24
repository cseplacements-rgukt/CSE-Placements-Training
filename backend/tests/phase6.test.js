const request = require("supertest");
const app = require("../server");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Submission = require("../models/Submission");

jest.mock("../middleware/auth", () => {
  const User = require("../models/User");
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    const uidMap = {
      "valid-tnpc-token": "tnpc123",
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

describe("Phase 6: Mock Exam Operations & Reliability", () => {
  let tnpcAdmin, student, student2, draftExam, publishedExam, closedExam;

  beforeEach(async () => {
    tnpcAdmin = await User.create({ firebaseUid: "tnpc123", email: "tnpc@test.com", name: "TNPC", role: "coordinator" });
    student = await User.create({ firebaseUid: "student123", email: "student@test.com", name: "Student", role: "student" });
    student2 = await User.create({ firebaseUid: "student456", email: "student2@test.com", name: "Student 2", role: "student" });

    const dummyQuestion = {
      type: "mcq",
      question: "Sample Question",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      points: 1
    };

    draftExam = await Exam.create({
      title: "Draft Exam", targetCompany: "Test", teacherId: tnpcAdmin._id,
      scheduledAt: new Date(), duration: 60, endTime: new Date(Date.now() + 3600000),
      status: "draft", isActive: false, questions: [dummyQuestion]
    });

    publishedExam = await Exam.create({
      title: "Published Exam", targetCompany: "Test", teacherId: tnpcAdmin._id,
      scheduledAt: new Date(Date.now() - 60000), duration: 60, endTime: new Date(Date.now() + 3600000),
      status: "published", isActive: true, questions: [dummyQuestion]
    });

    closedExam = await Exam.create({
      title: "Closed Exam", targetCompany: "Test", teacherId: tnpcAdmin._id,
      scheduledAt: new Date(Date.now() - 3600000), duration: 60, endTime: new Date(Date.now() - 60000),
      status: "closed", isActive: true, questions: [dummyQuestion]
    });
  });

  it("1. Draft exam inaccessible to students", async () => {
    const res = await request(app).get(`/api/exams/${draftExam._id}`).set("Authorization", "Bearer valid-student-token");
    expect(res.status).toBe(403);
  });

  it("2. Published exam accessible to students with submission", async () => {
    // Under the new exam-code security model, students must have a submission
    await Submission.create({
      examId: publishedExam._id,
      studentId: student._id,
      status: "in_progress",
      startedAt: new Date(),
    });
    const res = await request(app).get(`/api/exams/${publishedExam._id}`).set("Authorization", "Bearer valid-student-token");
    expect(res.status).toBe(200);
  });

  it("3. Closed exam cannot start new attempts", async () => {
    const res = await request(app).post(`/api/submissions/start`).set("Authorization", "Bearer valid-student-token").send({ examId: closedExam._id });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("ended");
  });

  it("4. Unauthorized student cannot modify exam", async () => {
    const res = await request(app).put(`/api/exams/${publishedExam._id}/publish`).set("Authorization", "Bearer valid-student-token");
    expect(res.status).toBe(403);
  });

  it("5. TNPC Admin can manage permitted exams", async () => {
    const res = await request(app).put(`/api/exams/${draftExam._id}/publish`).set("Authorization", "Bearer valid-tnpc-token");
    expect(res.status).toBe(200);
    expect(res.body.exam.status).toBe("published");
  });

  it("6. Student cannot access another student's submission", async () => {
    const sub = await Submission.create({ examId: publishedExam._id, studentId: student2._id, status: "submitted" });
    const res = await request(app).get(`/api/submissions/${sub._id}`).set("Authorization", "Bearer valid-student-token");
    expect(res.status).toBe(403);
  });

  it("7. Duplicate submission is rejected atomically", async () => {
    const sub = await Submission.create({ examId: publishedExam._id, studentId: student._id, status: "in_progress", startedAt: new Date() });
    
    // Attempt double submit
    const res1 = request(app).post(`/api/submissions`).set("Authorization", "Bearer valid-student-token").send({ examId: publishedExam._id, submissionId: sub._id, answers: [] });
    const res2 = request(app).post(`/api/submissions`).set("Authorization", "Bearer valid-student-token").send({ examId: publishedExam._id, submissionId: sub._id, answers: [] });
    
    const [out1, out2] = await Promise.all([res1, res2]);
    expect([out1.status, out2.status].sort()).toEqual([201, 400]); // One succeeds, one fails
  });

  it("8. Submission after deadline is rejected/auto-submitted safely", async () => {
    // Student started 90 minutes ago for a 60 min exam
    const sub = await Submission.create({ 
      examId: publishedExam._id, studentId: student._id, 
      status: "in_progress", startedAt: new Date(Date.now() - 90 * 60000) 
    });
    
    const res = await request(app).post(`/api/submissions`).set("Authorization", "Bearer valid-student-token").send({ examId: publishedExam._id, submissionId: sub._id, answers: [] });
    
    // Should be accepted but warning logged, graded based on auto-save
    expect(res.status).toBe(201);
  });
});
