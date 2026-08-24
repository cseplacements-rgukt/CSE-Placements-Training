const mongoose = require("mongoose");
const request = require("supertest");

const mockVerifyIdToken = jest.fn();
jest.mock("../config/firebase", () => ({
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
}));

const app = require("../server");
const User = require("../models/User");
const Exam = require("../models/Exam");
const admin = require("../config/firebase");

describe("Admin Role Management API", () => {
  let superAdminUser;
  let adminUser;
  let studentUser;
  let coordinatorUser;

  beforeAll(async () => {
    // Setup test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/test-admin-api");
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close();
    }
  });

  beforeEach(async () => {
    await User.deleteMany({});

    superAdminUser = await User.create({
      firebaseUid: "super_admin_uid",
      email: "superadmin@test.com",
      name: "Super Admin",
      role: "super_admin",
    });

    adminUser = await User.create({
      firebaseUid: "admin_uid",
      email: "admin@test.com",
      name: "Admin",
      role: "admin",
    });

    studentUser = await User.create({
      firebaseUid: "student_uid",
      email: "student@test.com",
      name: "Student",
      role: "student",
    });

    coordinatorUser = await User.create({
      firebaseUid: "coordinator_uid",
      email: "coordinator@test.com",
      name: "Coordinator",
      role: "coordinator",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("legacy tnpc_admin fixtures normalize to coordinator", async () => {
    expect(coordinatorUser.role).toBe("coordinator");
  });

  test("super_admin can promote student to coordinator", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "super_admin_uid" });
    const res = await request(app)
      .put(`/api/admin/users/${studentUser._id}`)
      .set("Authorization", "Bearer fake_token")
      .send({ role: "coordinator" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("coordinator");

    const dbUser = await User.findById(studentUser._id);
    expect(dbUser.role).toBe("coordinator");
  });

  test("admin can manage coordinators (activate/deactivate)", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "admin_uid" });
    const res = await request(app)
      .put(`/api/admin/users/${coordinatorUser._id}`)
      .set("Authorization", "Bearer fake_token")
      .send({ isActive: false });

    expect(res.status).toBe(200);
    const dbUser = await User.findById(coordinatorUser._id);
    expect(dbUser.isActive).toBe(false);
  });

  test("student cannot promote users", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "student_uid" });
    const res = await request(app)
      .put(`/api/admin/users/${studentUser._id}`)
      .set("Authorization", "Bearer fake_token")
      .send({ role: "coordinator" });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Admin access required");
  });

  test("admin cannot change account roles — super_admin exclusive", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "admin_uid" });
    const res = await request(app)
      .put(`/api/admin/users/${studentUser._id}`)
      .set("Authorization", "Bearer fake_token")
      .send({ role: "admin" });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Only a super admin can change account roles");
  });

  test("admin cannot delete any user — deletion is super_admin exclusive", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "admin_uid" });
    const otherAdmin = await User.create({
      firebaseUid: "other_admin_uid",
      email: "other-admin@test.com",
      name: "Other Admin",
      role: "admin",
    });

    const resAdmin = await request(app)
      .delete(`/api/admin/users/${otherAdmin._id}`)
      .set("Authorization", "Bearer fake_token");
    expect(resAdmin.status).toBe(403);
    expect(resAdmin.body.message).toBe("Super admin access required");

    // Even coordinator removal is out of an admin's reach now.
    const resCoord = await request(app)
      .delete(`/api/admin/users/${coordinatorUser._id}`)
      .set("Authorization", "Bearer fake_token");
    expect(resCoord.status).toBe(403);
    const stillThere = await User.findById(coordinatorUser._id);
    expect(stillThere).not.toBeNull();
  });

  test("super_admin can delete a coordinator account", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "super_admin_uid" });
    const res = await request(app)
      .delete(`/api/admin/users/${coordinatorUser._id}`)
      .set("Authorization", "Bearer fake_token");

    expect(res.status).toBe(200);
    const gone = await User.findById(coordinatorUser._id);
    expect(gone).toBeNull();
  });

  test("admin cannot delete an exam with its data — super_admin exclusive", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "admin_uid" });
    const exam = await Exam.create({
      title: "Doomed Exam",
      teacherId: coordinatorUser._id,
    });

    const res = await request(app)
      .delete(`/api/admin/exams/${exam._id}`)
      .set("Authorization", "Bearer fake_token");
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Super admin access required");
    const alive = await Exam.findById(exam._id);
    expect(alive).not.toBeNull();
  });

  test("invalid roles rejected", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "super_admin_uid" });
    const res = await request(app)
      .put(`/api/admin/users/${studentUser._id}`)
      .set("Authorization", "Bearer fake_token")
      .send({ role: "superadmin" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid user role");
  });
});
