const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = require("../server");
const Exam = require("../models/Exam");
const User = require("../models/User");

describe("Minimum exam time before submit", () => {
  let student, exam;
  const PASSWORD = "minPw55";

  const loginToken = async () => {
    const res = await request(app)
      .post("/api/auth/student-login")
      .send({ identifier: "s260888", password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token;
  };

  const createExam = async (settings = {}) => {
    return Exam.create({
      title: "Min Time Exam",
      targetCompany: "Infosys",
      teacherId: student._id,
      scheduledAt: new Date(Date.now() - 60000),
      duration: 60,
      endTime: new Date(Date.now() + 3600000),
      status: "published",
      isActive: true,
      examCode: "MINTIME",
      settings,
      questions: [
        { type: "mcq", question: "Q?", options: ["a", "b"], correctAnswer: "a", points: 2 },
        { type: "mcq", question: "Q2?", options: ["x", "y"], correctAnswer: "y", points: 3 },
      ],
    });
  };

  const startExam = async (token, examDoc) => {
    const res = await request(app)
      .post("/api/submissions/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ examId: String(examDoc._id), examCode: "MINTIME" });
    expect([200, 201]).toContain(res.status);
    return res;
  };

  const submitExam = async (token, examDoc, submissionId) => {
    return request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        examId: String(examDoc._id),
        submissionId,
        answers: [
          { questionId: String(examDoc.questions[0]._id), answer: "a" },
          { questionId: String(examDoc.questions[1]._id), answer: "y" },
        ],
      });
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/test-min-duration",
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
      firebaseUid: "roster:s260888",
      email: "s260888@rguktsklm.ac.in",
      name: "Min Time",
      role: "student",
      idNumber: "S260888",
      idNumberNormalized: "s260888",
      batchYear: 2026,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    });
  });

  test("rejects a submit before the minimum time and reports when it unlocks", async () => {
    exam = await createExam({ minDurationMinutes: 30 });
    const token = await loginToken();
    const start = await startExam(token, exam);

    const tooEarly = await submitExam(token, exam, start.body.submission._id);
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.code).toBe("MIN_TIME_NOT_REACHED");
    expect(tooEarly.body.remainingSeconds).toBeGreaterThan(29 * 60);
    expect(new Date(tooEarly.body.canSubmitAt).getTime()).toBeGreaterThan(
      Date.now() + 29 * 60 * 1000,
    );

    // The attempt must NOT have locked the submission — the student can
    // keep answering and auto-saving.
    const fresh = await request(app)
      .get(`/api/submissions/${start.body.submission._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(fresh.body.submission.status).toBe("in_progress");
  }, 30000);

  test("accepts the submit once the minimum time has elapsed", async () => {
    exam = await createExam({ minDurationMinutes: 30 });
    const token = await loginToken();
    const start = await startExam(token, exam);

    // Simulate elapsed time by backdating startedAt directly.
    await mongoose.model("Submission").updateOne(
      { _id: start.body.submission._id },
      { $set: { startedAt: new Date(Date.now() - 31 * 60 * 1000) } },
    );

    const ok = await submitExam(token, exam, start.body.submission._id);
    expect(ok.status).toBe(201);
    expect(ok.body.gradingStatus).toBe("completed");
  }, 30000);

  test("no floor configured (default) submits immediately as before", async () => {
    exam = await createExam({});
    expect(exam.settings.minDurationMinutes).toBe(0);
    const token = await loginToken();
    const start = await startExam(token, exam);
    const ok = await submitExam(token, exam, start.body.submission._id);
    expect(ok.status).toBe(201);
  }, 30000);

  test("exam schema rejects a minimum time >= duration", async () => {
    let err = null;
    try {
      await createExam({ minDurationMinutes: 60 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/less than the exam duration/i);
  });

  test("join response advertises minDurationMinutes to students", async () => {
    exam = await createExam({ minDurationMinutes: 15 });
    const token = await loginToken();
    const join = await request(app)
      .post("/api/exams/join")
      .set("Authorization", `Bearer ${token}`)
      .send({ examCode: "MINTIME" });
    expect(join.status).toBe(200);
    expect(join.body.exam.settings.minDurationMinutes).toBe(15);
  });
});
