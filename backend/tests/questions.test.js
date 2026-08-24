const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const Question = require("../models/Question");
const User = require("../models/User");
const admin = require("firebase-admin");

jest.mock("firebase-admin", () => ({
  auth: jest.fn().mockReturnValue({
    verifyIdToken: jest.fn(),
  }),
}));

describe("Question API Endpoints", () => {
  let tnpcAdminToken = "valid-tnpc-token";
  let studentToken = "valid-student-token";
  let tnpcAdmin;
  let student;

  beforeEach(async () => {
    // Setup users
    tnpcAdmin = await User.create({
      firebaseUid: "tnpc123",
      email: "tnpc@test.com",
      name: "TNPC Admin",
      role: "coordinator",
    });

    student = await User.create({
      firebaseUid: "student123",
      email: "student@test.com",
      name: "Student",
      role: "student",
    });
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Question.deleteMany({});
  });

  afterEach(async () => {
    await Question.deleteMany({});
  });

  describe("Bulk Import (/api/questions/import)", () => {
    it("should allow TNPC admin to import valid questions", async () => {
      admin.auth().verifyIdToken.mockResolvedValue({ uid: "tnpc123" });

      const payload = {
        questions: [
          {
            question: "Test Q1",
            type: "mcq",
            options: ["A", "B", "C"],
            correctAnswer: "A",
            targetCompany: "TCS"
          },
          {
            question: "Test Q2",
            type: "short_answer",
            correctAnswer: "Answer 2",
            targetCompany: "TCS"
          }
        ]
      };

      const res = await request(app)
        .post("/api/questions/import")
        .set("Authorization", `Bearer ${tnpcAdminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(2);

      const qCount = await Question.countDocuments();
      expect(qCount).toBe(2);
    });

    it("should reject import if student tries", async () => {
      admin.auth().verifyIdToken.mockResolvedValue({ uid: "student123" });

      const res = await request(app)
        .post("/api/questions/import")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({ questions: [] });

      expect(res.status).toBe(403);
    });

    it("should reject partial import if one question is invalid", async () => {
      admin.auth().verifyIdToken.mockResolvedValue({ uid: "tnpc123" });

      const payload = {
        questions: [
          {
            question: "Valid Q1",
            type: "mcq",
            options: ["A", "B"],
            correctAnswer: "A"
          },
          {
            question: "Invalid Q2",
            type: "mcq",
            options: ["A", "B"],
            correctAnswer: "C" // Invalid: not in options
          }
        ]
      };

      const res = await request(app)
        .post("/api/questions/import")
        .set("Authorization", `Bearer ${tnpcAdminToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.invalid).toBe(1);

      // Verify ATOMICITY: No questions should be inserted
      const qCount = await Question.countDocuments();
      expect(qCount).toBe(0);
    });

    it("should reject duplicates in database", async () => {
      admin.auth().verifyIdToken.mockResolvedValue({ uid: "tnpc123" });

      await Question.create({
        question: "Existing Q",
        type: "mcq",
        options: ["1", "2"],
        correctAnswer: "1",
        targetCompany: "General",
        createdBy: tnpcAdmin._id
      });

      const payload = {
        questions: [
          {
            question: "Existing Q", // Duplicate
            type: "mcq",
            options: ["1", "2"],
            correctAnswer: "1",
            targetCompany: "General"
          }
        ]
      };

      const res = await request(app)
        .post("/api/questions/import")
        .set("Authorization", `Bearer ${tnpcAdminToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].message).toContain("already exists");
    });

    it("should enforce batch limits", async () => {
      admin.auth().verifyIdToken.mockResolvedValue({ uid: "tnpc123" });

      const largeBatch = Array(201).fill({
        question: "Q", type: "short_answer", correctAnswer: "A"
      });

      const res = await request(app)
        .post("/api/questions/import")
        .set("Authorization", `Bearer ${tnpcAdminToken}`)
        .send({ questions: largeBatch });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("exceeds limit");
    });
  });
});
