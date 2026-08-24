const mongoose = require("mongoose");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const mockVerifyIdToken = jest.fn();
const mockCreateUser = jest.fn();
const mockDeleteUser = jest.fn();
jest.mock("../config/firebase", () => ({
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
    createUser: mockCreateUser,
    deleteUser: mockDeleteUser,
  }),
}));

const app = require("../server");
const User = require("../models/User");
const Submission = require("../models/Submission");
const AppSetting = require("../models/AppSetting");

describe("Student roster & staff provisioning", () => {
  let superAdmin;
  let plainAdmin;

  const staffTokenFor = (uid) => `firebase:${uid}`;

  const authAs = async (user) => {
    mockVerifyIdToken.mockResolvedValue({ uid: user.firebaseUid });
    return user;
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/test-roster",
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
    await Promise.all([
      User.deleteMany({}),
      Submission.deleteMany({}),
      AppSetting.deleteMany({}),
    ]);

    superAdmin = await User.create({
      firebaseUid: "sa_uid",
      email: "super@test.com",
      name: "Super Admin",
      role: "super_admin",
    });
    plainAdmin = await User.create({
      firebaseUid: "admin_uid",
      email: "admin2@test.com",
      name: "Plain Admin",
      role: "admin",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Roster management ──────────────────────────────────────────────
  describe("roster CRUD", () => {
    test("admin can add a student; email is derived from the ID", async () => {
      await authAs(superAdmin);
      const res = await request(app)
        .post("/api/students")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ idNumber: "S210574", name: "Anjali R", batchYear: 2025, password: "resPw01" });

      expect(res.status).toBe(201);
      expect(res.body.student.email).toBe("s210574@rguktsklm.ac.in");
      expect(res.body.student.idNumber).toBe("S210574");
      expect(res.body.student.batchYear).toBe(2025);
    });

    test("no prefix/format validation on IDs — transfer letters accepted", async () => {
      await authAs(superAdmin);
      for (const id of ["o210231", "N210089", "r210042", "x99zzz"]) {
        const res = await request(app)
          .post("/api/students")
          .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
          .send({ idNumber: id, name: `Student ${id}`, batchYear: 2025, password: "resPw02" });
        expect(res.status).toBe(201);
      }
    });

    test("duplicate ID rejected case-insensitively", async () => {
      await authAs(superAdmin);
      const base = {
        Authorization: `Bearer ${staffTokenFor("sa_uid")}`,
      };
      await request(app)
        .post("/api/students")
        .set(base)
        .send({ idNumber: "s210574", name: "First", batchYear: 2025, password: "resPw03" });

      const res = await request(app)
        .post("/api/students")
        .set(base)
        .send({ idNumber: "S210574", name: "Dup", batchYear: 2025, password: "resPw04" });

      expect(res.status).toBe(409);
    });

    test("coordinator cannot manage the roster", async () => {
      const coordinator = await User.create({
        firebaseUid: "co_uid",
        email: "co@test.com",
        name: "Coordinator",
        role: "coordinator",
      });
      await authAs(coordinator);
      const res = await request(app)
        .get("/api/students")
        .set("Authorization", `Bearer ${staffTokenFor("co_uid")}`);
      expect(res.status).toBe(403);
    });

    test("CSV bulk import creates students and skips duplicates", async () => {
      await authAs(superAdmin);
      const csv = [
        "idnumber,name,batch,examcellpassword",
        "s220001,Bulk One,2026,bulkPw1",
        "s220002,Bulk Two,2026,bulkPw2",
        "s220001,Duplicate,2026,other99",
      ].join("\n");

      const res = await request(app)
        .post("/api/students/import")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ csv });

      expect(res.status).toBe(200);
      expect(res.body.results.created).toBe(2);
      expect(res.body.results.skippedDuplicates).toBe(1);
    });
  });

  // ─── Student login ──────────────────────────────────────────────────
  describe("student login (ID/email + own exam-cell password)", () => {
    beforeEach(async () => {
      await User.create({
        firebaseUid: "roster:s210574",
        email: "s210574@rguktsklm.ac.in",
        name: "Anjali R",
        role: "student",
        idNumber: "S210574",
        idNumberNormalized: "s210574",
        batchYear: 2025,
        passwordHash: await bcrypt.hash("resPw01", 10),
      });
    });

    test("login by ID works case-insensitively and issues a usable token", async () => {
      const res = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "S210574", password: "resPw01" });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("s210574@rguktsklm.ac.in");
      expect(res.body.token.split(".")).toHaveLength(3);

      // The issued token authorizes requests through the normal middleware.
      const me = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe("student");
      expect(me.body.user.name).toBe("Anjali R");
    });

    test("login by full college email resolves the same account", async () => {
      const res = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s210574@rguktsklm.ac.in", password: "resPw01" });
      expect(res.status).toBe(200);
    });

    test("password is case-sensitive bcrypt, wrong password rejected", async () => {
      const wrongCase = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s210574", password: "respw01" });
      expect(wrongCase.status).toBe(401);

      const bad = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s210574", password: "zzzzz99" });
      expect(bad.status).toBe(401);
      expect(bad.body.message).toMatch(/incorrect/i);
    });
  });

  // ─── Per-student exam-cell password + unified login detection ───────
  describe("per-student exam-cell passwords", () => {
    test("student created with own password logs in with it (no shared pw needed)", async () => {
      await authAs(superAdmin);
      const add = await request(app)
        .post("/api/students")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ idNumber: "s240001", name: "Own Pw", batchYear: 2026, password: "myCollege#1" });
      expect(add.status).toBe(201);

      // Personal password works…
      const ok = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s240001", password: "myCollege#1" });
      expect(ok.status).toBe(200);

      // …and is case-sensitive bcrypt, unlike the legacy shared code.
      const wrong = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s240001", password: "mycollege#1" });
      expect(wrong.status).toBe(401);
    });

    test("CSV import hashes each student's own password; rows without one are rejected", async () => {
      await authAs(superAdmin);
      const csv = [
        "idnumber,name,batch,examcellpassword",
        "s240002,Csv Kid,2026,colPw12",
        "s240003,No Pw Kid,2026,",
      ].join("\n");

      const res = await request(app)
        .post("/api/students/import")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ csv });
      expect(res.status).toBe(200);
      expect(res.body.results.created).toBe(1);
      expect(res.body.results.errors).toHaveLength(1);
      expect(res.body.results.errors[0].message).toMatch(/password/i);

      const withPw = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s240002", password: "colPw12" });
      expect(withPw.status).toBe(200);

      // Without an individual password there is no fallback — login fails.
      const noPw = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s240003", password: "anything1" });
      expect(noPw.status).toBe(401);
    });

    test("admin can reset one student's password via the API", async () => {
      await authAs(superAdmin);
      const add = await request(app)
        .post("/api/students")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ idNumber: "s240004", name: "Reset Me", batchYear: 2026, password: "first123" });
      const id = add.body.student._id;

      const reset = await request(app)
        .put(`/api/students/${id}/password`)
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ password: "second456" });
      expect(reset.status).toBe(200);

      const oldPw = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s240004", password: "first123" });
      expect(oldPw.status).toBe(401);

      const newPw = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s240004", password: "second456" });
      expect(newPw.status).toBe(200);
    });

    test("password outside 4-64 chars rejected on add", async () => {
      await authAs(superAdmin);
      const res = await request(app)
        .post("/api/students")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ idNumber: "s240005", name: "Shorty", batchYear: 2026, password: "abc" });
      expect(res.status).toBe(400);
    });
  });

  describe("unified login account detection", () => {
    beforeEach(async () => {
      await User.create({
        firebaseUid: "roster:s250001",
        email: "s250001@rguktsklm.ac.in",
        name: "Detect Me",
        role: "student",
        idNumber: "S250001",
        batchYear: 2027,
      });
    });

    test.each([
      ["S250001", "student"],
      ["s250001", "student"],
      ["s250001@rguktsklm.ac.in", "student"],
      ["unknown.staff@test.com", "staff"],
      ["not-in-roster", "staff"],
    ])("%p → %p", async (identifier, expected) => {
      const res = await request(app)
        .post("/api/auth/detect-account")
        .send({ identifier });
      expect(res.status).toBe(200);
      expect(res.body.accountType).toBe(expected);
    });

    test("requires an identifier", async () => {
      const res = await request(app)
        .post("/api/auth/detect-account")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── Hard delete / batch delete ─────────────────────────────────────
  describe("hard deletion of students and batches", () => {
    let student;

    beforeEach(async () => {
      student = await User.create({
        firebaseUid: "roster:s230001",
        email: "s230001@rguktsklm.ac.in",
        name: "Batch Kid",
        role: "student",
        idNumber: "s230001",
        batchYear: 2027,
        passwordHash: await bcrypt.hash("resPw05", 10),
      });
      await Submission.create({
        studentId: student._id,
        examId: new mongoose.Types.ObjectId(),
        answers: [
          {
            questionId: new mongoose.Types.ObjectId(),
            selectedOption: "A",
            isCorrect: false,
          },
        ],
        totalQuestions: 1,
      });
    });

    test("single delete removes the login but KEEPS submission history", async () => {
      await authAs(superAdmin);
      const res = await request(app)
        .delete(`/api/students/${student._id}`)
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`);

      expect(res.status).toBe(200);
      expect(await User.findById(student._id)).toBeNull();
      // History is intentionally preserved for reporting.
      expect(await Submission.countDocuments({ studentId: student._id })).toBe(1);
    });

    test("plain admin CANNOT delete a single student", async () => {
      await authAs(plainAdmin);
      const res = await request(app)
        .delete(`/api/students/${student._id}`)
        .set("Authorization", `Bearer ${staffTokenFor("admin_uid")}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Only a super admin can delete student records");
      expect(await User.findById(student._id)).not.toBeNull();
    });

    test("batch delete requires typing the year as confirmation and keeps history", async () => {
      await authAs(superAdmin);
      const wrong = await request(app)
        .post("/api/students/delete-batch")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ batchYear: 2027, confirmBatchYear: "2028" });
      expect(wrong.status).toBe(400);

      const right = await request(app)
        .post("/api/students/delete-batch")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({ batchYear: 2027, confirmBatchYear: "2027" });
      expect(right.status).toBe(200);
      expect(right.body.deletedCount).toBe(1);
      expect(await User.countDocuments({ role: "student" })).toBe(0);
      // History survives the batch wipe.
      expect(await Submission.countDocuments({})).toBe(1);
    });

    test("plain admin CANNOT delete a batch", async () => {
      await authAs(plainAdmin);
      const res = await request(app)
        .post("/api/students/delete-batch")
        .set("Authorization", `Bearer ${staffTokenFor("admin_uid")}`)
        .send({ batchYear: 2027, confirmBatchYear: "2027" });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Only a super admin can delete an entire batch");
      expect(await User.countDocuments({ role: "student" })).toBe(1);
    });

    test("submissions created via /start carry an identity snapshot usable after deletion", async () => {
      const Exam = require("../models/Exam");
      const exam = await Exam.create({
        title: "Snapshot Exam",
        targetCompany: "Infosys",
        teacherId: superAdmin._id,
        scheduledAt: new Date(Date.now() - 60000),
        duration: 60,
        endTime: new Date(Date.now() + 3600000),
        status: "published",
        isActive: true,
        examCode: "SNAP01",
        questions: [
          {
            type: "mcq",
            question: "Q?",
            options: ["a", "b"],
            correctAnswer: "a",
            points: 1,
          },
        ],
      });

      // Roster student signs in and starts the exam with their JWT.
      const login = await request(app)
        .post("/api/auth/student-login")
        .send({ identifier: "s230001", password: "resPw05" });
      expect(login.status).toBe(200);

      const start = await request(app)
        .post("/api/submissions/start")
        .set("Authorization", `Bearer ${login.body.token}`)
        .send({ examId: String(exam._id), examCode: "SNAP01" });
      expect(start.status).toBe(201);

      const submissionId = start.body.submission._id;

      // Delete the account — snapshot must remain on the document.
      await request(app)
        .delete(`/api/students/${student._id}`)
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`);

      const stored = await Submission.findById(submissionId)
        .select("studentName studentIdNumber batchYear studentId")
        .lean();
      expect(stored.studentName).toBe("Batch Kid");
      expect(stored.studentIdNumber).toBe("s230001");
      expect(stored.batchYear).toBe(2027);

      // The display fallback resolves the now-orphaned reference.
      const { resolveStudentDisplay } = require("../utils/studentSnapshot");
      const display = resolveStudentDisplay({
        ...stored,
        studentId: null, // simulate a populate that found no live user
      });
      expect(display.studentId.name).toBe("Batch Kid");
      expect(display.studentId.idNumber).toBe("s230001");
      expect(display.studentId.deletedStudent).toBe(true);
    });
  });

  // ─── Staff provisioning RBAC ────────────────────────────────────────
  describe("staff provisioning", () => {
    test("admin cannot create an admin — super_admin exclusive", async () => {
      await authAs(plainAdmin);
      const res = await request(app)
        .post("/api/staff")
        .set("Authorization", `Bearer ${staffTokenFor("admin_uid")}`)
        .send({ name: "Sneaky Admin", email: "sneaky@test.com", role: "admin" });
      expect(res.status).toBe(403);
    });

    test("super_admin creates a coordinator with a Firebase account + temp password", async () => {
      mockCreateUser.mockResolvedValue({ uid: "fb_new_coord" });
      await authAs(superAdmin);

      const res = await request(app)
        .post("/api/staff")
        .set("Authorization", `Bearer ${staffTokenFor("sa_uid")}`)
        .send({
          name: "New Coord",
          email: "newcoord@test.com",
          role: "coordinator",
        });

      expect(res.status).toBe(201);
      expect(res.body.tempPassword).toBeTruthy();
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: "newcoord@test.com" }),
      );
      const created = await User.findOne({ email: "newcoord@test.com" });
      expect(created.role).toBe("coordinator");
    });

    test("admin CAN create a coordinator", async () => {
      mockCreateUser.mockResolvedValue({ uid: "fb_coord_2" });
      await authAs(plainAdmin);

      const res = await request(app)
        .post("/api/staff")
        .set("Authorization", `Bearer ${staffTokenFor("admin_uid")}`)
        .send({ name: "Coord Two", email: "coordtwo@test.com", role: "coordinator" });
      expect(res.status).toBe(201);
    });

    test("admin sees only coordinators in the staff list", async () => {
      await User.create({
        firebaseUid: "other_admin",
        email: "other-admin@test.com",
        name: "Other Admin",
        role: "admin",
      });
      await User.create({
        firebaseUid: "co_listed",
        email: "colisted@test.com",
        name: "Listed Coord",
        role: "coordinator",
      });

      await authAs(plainAdmin);
      const res = await request(app)
        .get("/api/staff/users")
        .set("Authorization", `Bearer ${staffTokenFor("admin_uid")}`);

      expect(res.status).toBe(200);
      const roles = res.body.users.map((u) => u.role);
      expect(roles).toContain("coordinator");
      expect(roles).not.toContain("admin");
    });

    test("public registration endpoint refuses to create accounts", async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: "brand_new_fb_user" });
      const res = await request(app)
        .post("/api/auth/register")
        .set("Authorization", "Bearer whatever")
        .send({ email: "random@test.com", name: "Random", role: "student" });
      expect(res.status).toBe(403);
    });

    test("legacy tnpc_admin accounts still authenticate as coordinators via alias migration", async () => {
      // Simulate a DB row written before the rename.
      const legacy = await User.collection.insertOne({
        firebaseUid: "legacy_tnpc_uid",
        email: "legacy@tnpc.test",
        name: "Legacy TNPC",
        role: "tnpc_admin",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockVerifyIdToken.mockResolvedValue({ uid: "legacy_tnpc_uid" });
      const me = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer legacy_token");

      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe("coordinator");
      void legacy;
    });
  });

  // ─── Middleware dual-path sanity ─────────────────────────────────────
  describe("auth middleware", () => {
    test("rejects garbage tokens", async () => {
      mockVerifyIdToken.mockRejectedValue(new Error("bad token"));
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer not-a-real-token");
      expect(res.status).toBe(403);
    });

    test("signStudentToken round-trips through verification", () => {
      const { signStudentToken } = require("../middleware/auth");
      const token = signStudentToken({
        _id: new mongoose.Types.ObjectId(),
        firebaseUid: "roster:x1",
        email: "x1@rguktsklm.ac.in",
      });
      const payload = jwt.verify(token, require("../middleware/auth").JWT_SECRET);
      expect(payload.authType).toBe("student-roster");
      expect(payload.uid).toBe("roster:x1");
    });

    // ── No alternate identity binding (Google sign-in removed) ──
    test("unknown Firebase identity does NOT bind to an account by matching email", async () => {
      await User.create({
        firebaseUid: "roster:s999999",
        email: "s999999@rguktsklm.ac.in",
        name: "Roster Only",
        role: "student",
        idNumber: "S999999",
        batchYear: 2025,
      });
      mockVerifyIdToken.mockResolvedValue({
        uid: "attacker_google_uid",
        email: "s999999@rguktsklm.ac.in",
      });
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer google-token");
      expect(res.status).toBe(404);
      const unchanged = await User.findOne({ email: "s999999@rguktsklm.ac.in" });
      expect(unchanged.firebaseUid).toBe("roster:s999999");
    });

    test("unknown Firebase identity sharing a STAFF email is rejected too", async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: "random_google_uid",
        email: "admin2@test.com",
      });
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer google-token");
      expect(res.status).toBe(404);
      const bound = await User.findOne({ firebaseUid: "random_google_uid" });
      expect(bound).toBeNull();
    });
  });
});
