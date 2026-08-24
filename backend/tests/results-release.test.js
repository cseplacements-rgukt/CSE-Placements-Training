const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = require("../server");
const Exam = require("../models/Exam");
const User = require("../models/User");

describe("Result release gating (exam end + 5 min)", () => {
  let student, exam;
  const PASSWORD = "resPw77";

  const loginToken = async () => {
    const res = await request(app)
      .post("/api/auth/student-login")
      .send({ identifier: "s260777", password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token;
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/test-results",
      );
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close();
    }
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Exam.deleteMany({})]);
    student = await User.create({
      firebaseUid: "roster:s260777",
      email: "s260777@rguktsklm.ac.in",
      name: "Gate Kid",
      role: "student",
      idNumber: "S260777",
      idNumberNormalized: "s260777",
      batchYear: 2026,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    });
    exam = await Exam.create({
      title: "Gated Exam",
      targetCompany: "TCS",
      teacherId: student._id,
      scheduledAt: new Date(Date.now() - 60000),
      duration: 60,
      endTime: new Date(Date.now() + 3600000),
      status: "published",
      isActive: true,
      examCode: "GATE01",
      questions: [
        { type: "mcq", question: "Q?", options: ["a", "b"], correctAnswer: "a", points: 2 },
      ],
    });
  });

  test("submit response hides scores until release time", async () => {
    const token = await loginToken();
    const start = await request(app)
      .post("/api/submissions/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ examId: String(exam._id), examCode: "GATE01" });
    expect(start.status).toBe(201);

    const submit = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        examId: String(exam._id),
        submissionId: start.body.submission._id,
        answers: [{ questionId: String(exam.questions[0]._id), answer: "a" }],
      });
    expect(submit.status).toBe(201);
    expect(submit.body.resultsPending).toBe(true);
    expect(new Date(submit.body.resultsReleaseAt).getTime()).toBeGreaterThan(
      Date.now() + 4 * 60 * 1000,
    );
    expect(submit.body.score).toBeUndefined();
    expect(submit.body.message).toMatch(/after the exam window closes/i);

    // my-submissions is gated too
    const mine = await request(app)
      .get("/api/submissions/my-submissions")
      .set("Authorization", `Bearer ${token}`);
    const row = mine.body.submissions.find(
      (s) => String(s._id) === String(start.body.submission._id),
    );
    expect(row.resultsPending).toBe(true);
    expect(row.score).toBe(0);

    // detail view is gated as well
    const detail = await request(app)
      .get(`/api/submissions/${start.body.submission._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.body.submission.resultsPending).toBe(true);
    expect(detail.body.submission.answers[0].isCorrect).toBeUndefined();
    expect(detail.body.submission.examId.questions[0].correctAnswer).toBeUndefined();
  });

  test("scores become visible once endTime + 5 min passes", async () => {
    const token = await loginToken();
    const start = await request(app)
      .post("/api/submissions/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ examId: String(exam._id), examCode: "GATE01" });
    const submit = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        examId: String(exam._id),
        submissionId: start.body.submission._id,
        answers: [{ questionId: String(exam.questions[0]._id), answer: "a" }],
      });

    // Fast-forward the window: whole exam is over.
    await Exam.updateOne(
      { _id: exam._id },
      { $set: { endTime: new Date(Date.now() - 6 * 60 * 1000) } },
    );

    const detail = await request(app)
      .get(`/api/submissions/${start.body.submission._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.body.submission.resultsPending).toBeUndefined();
    expect(detail.body.submission.score).toBe(2);
    expect(detail.body.submission.percentage).toBe(100);
    expect(detail.body.submission.answers[0].isCorrect).toBe(true);
  });
});
