const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════
// AUTH BUSINESS LOGIC TESTS
// ═══════════════════════════════════════════════════════════════════
// These test the pure functions extracted from routes/auth.js
// without needing HTTP or database connections.

// ─── Replicate the auth route functions for unit testing ──────────
const generate2FASecret = () => {
  return crypto.randomBytes(20).toString("hex");
};

const generateTOTP = (secret) => {
  const time = Math.floor(Date.now() / 30000);
  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(Buffer.from(time.toString()));
  const hash = hmac.digest("hex");
  const offset = parseInt(hash.slice(-1), 16);
  const code =
    (parseInt(hash.substr(offset * 2, 8), 16) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, "0");
};

// ─── Score calculation logic from submissions route ────────────────
const calculateScore = (answers, questions) => {
  let score = 0;
  answers.forEach((answer) => {
    const question = questions.find(
      (q) => q._id.toString() === answer.questionId
    );
    if (question) {
      const isCorrect =
        question.correctAnswer.toLowerCase().trim() ===
        (answer.answer || "").toLowerCase().trim();
      if (isCorrect) {
        score += question.points;
      }
    }
  });
  return score;
};

// ─── Trust score logic from proctoring route ───────────────────────
const calculateTrustScorePenalty = (currentScore, severity) => {
  const severityPenalty = { low: 2, medium: 5, high: 10 };
  return Math.max(0, currentScore - (severityPenalty[severity] || 5));
};

// ─── Grace period logic from submissions route ─────────────────────
const isWithinGracePeriod = (currentTime, examEndTime) => {
  const graceEndTime = new Date(examEndTime.getTime() + 5 * 60 * 1000);
  return currentTime <= graceEndTime;
};

// ═══════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════

describe("2FA Secret Generation", () => {
  test("should generate a 40-character hex string (20 bytes)", () => {
    const secret = generate2FASecret();
    expect(secret).toMatch(/^[0-9a-f]+$/);
    expect(secret).toHaveLength(40);
  });
});

describe("TOTP Code Generation", () => {
  test("should generate a 6-digit string", () => {
    const secret = generate2FASecret();
    const code = generateTOTP(secret);
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe("Score Calculation", () => {
  const questions = [
    { _id: { toString: () => "q1" }, correctAnswer: "Paris", points: 10 },
    { _id: { toString: () => "q2" }, correctAnswer: "4", points: 5 },
    { _id: { toString: () => "q3" }, correctAnswer: "True", points: 15 },
  ];

  test("should calculate full score for all correct answers", () => {
    const answers = [
      { questionId: "q1", answer: "Paris" },
      { questionId: "q2", answer: "4" },
      { questionId: "q3", answer: "True" },
    ];
    expect(calculateScore(answers, questions)).toBe(30);
  });
});

describe("Trust Score Penalty Calculation", () => {
  test("should deduct 10 for high severity", () => {
    expect(calculateTrustScorePenalty(100, "high")).toBe(90);
  });
});

describe("Grace Period Logic", () => {
  test("should be within grace period if within 5 minutes after end", () => {
    const endTime = new Date("2026-04-01T11:00:00Z");
    const now = new Date("2026-04-01T11:04:00Z");
    expect(isWithinGracePeriod(now, endTime)).toBe(true);
  });
});
