const request = require("supertest");
const express = require("express");

// Mock the models before importing routes
const Exam = require("../models/Exam");
const User = require("../models/User");
jest.mock("../models/Exam");
jest.mock("../models/User");

// Mock the auth middleware to bypass Firebase token verification
jest.mock("../middleware/auth", () => (req, res, next) => {
  req.user = { uid: "test_uid", email: "test@example.com", role: "teacher" };
  next();
});

const examRoutes = require("../routes/exams");

// Setup a minimal Express app for the component test
const app = express();
app.use(express.json());
app.use("/api/exams", examRoutes);

describe("Exam Router (Component Tests)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("GET /api/exams/:id should return 404 if exam not found", async () => {
    // Setup mock to return null (not found)
    Exam.findById.mockResolvedValue(null);

    const response = await request(app).get("/api/exams/507f1f77bcf86cd799439011");
    
    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Exam not found");
    expect(Exam.findById).toHaveBeenCalledWith("507f1f77bcf86cd799439011");
  });

  test("GET /api/exams/:id should return exam data if found", async () => {
    // Setup mock to return an exam
    const mockExam = { _id: "507f1f77bcf86cd799439011", title: "Test Exam" };
    Exam.findById.mockResolvedValue(mockExam);
    
    // Setup mock to return a user to bypass authorization check
    const mockUser = { _id: "user123", role: "teacher", firebaseUid: "test_uid" };
    User.findOne.mockResolvedValue(mockUser);

    const response = await request(app).get("/api/exams/507f1f77bcf86cd799439011");
    
    expect(response.status).toBe(200);
    expect(response.body.exam.title).toBe("Test Exam");
  });

  test("POST /api/exams should return 201 when a teacher creates an exam", async () => {
    // Setup mock for user validation check
    const mockUser = { _id: "user123", role: "coordinator", firebaseUid: "test_uid" };
    User.findOne.mockResolvedValue(mockUser);
    
    // Setup mock for exam.save
    Exam.prototype.save = jest.fn().mockResolvedValue(true);

    const payload = {
      title: "New Exam",
      duration: 60,
      scheduledAt: new Date(),
    };

    const response = await request(app).post("/api/exams").send(payload);
    
    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Exam created successfully");
  });

  test("POST /api/exams should return 403 if user is not a teacher or admin", async () => {
    // Setup mock for user validation check as student
    const mockUser = { _id: "user_student", role: "student", firebaseUid: "test_uid" };
    User.findOne.mockResolvedValue(mockUser);

    const response = await request(app).post("/api/exams").send({});
    
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "Only training-team staff (coordinator tier) can create exams",
    );
  });
});
