const mongoose = require("mongoose");


beforeAll(async () => {
  
});

afterAll(async () => {
  
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

const Notification = require("../models/Notification");
const Report = require("../models/Report");
const LoginAttempt = require("../models/LoginAttempt");
const RegistrationAttempt = require("../models/RegistrationAttempt");
const User = require("../models/User");

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Notification Model", () => {
  let userId;

  beforeEach(async () => {
    const user = await User.create({
      firebaseUid: "notif_user",
      email: "notif@test.com",
      name: "Notif User",
    });
    userId = user._id;
  });

  // ─── OO Checks ─────────────────────────────────────────────────
  describe("OO Checks: Schema and validation", () => {
    test("should create notification with required fields", async () => {
      const notif = await Notification.create({
        userId,
        type: "exam_scheduled",
        title: "Exam Scheduled",
        message: "Math exam on Monday",
      });

      expect(notif.userId.toString()).toBe(userId.toString());
      expect(notif.type).toBe("exam_scheduled");
      expect(notif.title).toBe("Exam Scheduled");
      expect(notif.message).toBe("Math exam on Monday");
      // Verify defaults
      expect(notif.isRead).toBe(false);
      expect(notif.priority).toBe("medium");
    });

    test("should reject invalid notification type", async () => {
      await expect(
        Notification.create({
          userId, type: "invalid_type", title: "T", message: "M",
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

  });
});

// ═══════════════════════════════════════════════════════════════════
// REPORT MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Report Model", () => {
  let userId;

  beforeEach(async () => {
    const user = await User.create({
      firebaseUid: "report_user",
      email: "report@test.com",
      name: "Report User",
      role: "admin",
    });
    userId = user._id;
  });

  // ─── OO Checks ─────────────────────────────────────────────────
  describe("OO Checks: Schema and defaults", () => {
    test("should create report with required fields", async () => {
      const report = await Report.create({
        type: "exam_analytics",
        title: "Exam Analytics Report",
        generatedBy: userId,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-03-01"),
      });

      expect(report.type).toBe("exam_analytics");
      expect(report.title).toBe("Exam Analytics Report");
      expect(report.generatedBy.toString()).toBe(userId.toString());
    });
  });

});

// ═══════════════════════════════════════════════════════════════════
// LOGIN ATTEMPT MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("LoginAttempt Model", () => {
  // ─── OO Checks ─────────────────────────────────────────────────
  describe("OO Checks: Schema and defaults", () => {
    test("should create with required email", async () => {
      const attempt = await LoginAttempt.create({ email: "test@example.com" });
      expect(attempt.email).toBe("test@example.com");
      expect(attempt.success).toBe(false);
    });
  });

});

// ═══════════════════════════════════════════════════════════════════
// REGISTRATION ATTEMPT MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("RegistrationAttempt Model", () => {
  // ─── Boundary Checks: Registration limits ─────────────────────
  describe("Boundary Checks: Registration limit tracking", () => {
    test("should count attempts within a time window", async () => {
      const email = "limit@test.com";
      await RegistrationAttempt.create({ email });
      await RegistrationAttempt.create({ email });
      await RegistrationAttempt.create({ email });

      const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const count = await RegistrationAttempt.countDocuments({
        email,
        attemptedAt: { $gte: windowStart },
      });

      expect(count).toBe(3);
    });
  });

});
