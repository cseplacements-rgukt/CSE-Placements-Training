// ═══════════════════════════════════════════════════════════════════
// FACE DETECTION BUSINESS LOGIC TESTS  (TC-053 → TC-057)
// ═══════════════════════════════════════════════════════════════════
// Pure unit tests for face-detection event classification and
// trust-score penalty logic used by the proctoring system.
// No DOM, no face-api.js, and no database required.

// ─── Replicate logic from proctoring route / ProctoringSession ────

const SEVERITY_PENALTY = { low: 2, medium: 5, high: 10 };

/**
 * Applies a trust score penalty based on event severity.
 * Trust score never goes below 0.
 * @param {number} currentScore
 * @param {"low"|"medium"|"high"} severity
 * @returns {number}
 */
const applyTrustScorePenalty = (currentScore, severity) => {
  return Math.max(0, currentScore - (SEVERITY_PENALTY[severity] ?? 5));
};

// ─── Face detection event classification logic ────────────────────
// Maps proctoring event types to their default severity level.
const EVENT_SEVERITY_MAP = {
  face_not_detected: "high",
  multiple_faces_detected: "medium",
  tab_switch: "medium",
  fullscreen_exit: "high",
  copy_paste: "low",
  noise_detected: "low",
};

/**
 * Returns the default severity for a given proctoring event type.
 * @param {string} eventType
 * @returns {"low"|"medium"|"high"|"unknown"}
 */
const getEventSeverity = (eventType) => {
  return EVENT_SEVERITY_MAP[eventType] ?? "unknown";
};

/**
 * Builds a proctoring event summary from an array of event objects.
 * @param {{ type: string, severity: string }[]} events
 * @returns {{ totalEvents: number, highSeverityEvents: number }}
 */
const buildEventSummary = (events) => {
  return {
    totalEvents: events.length,
    highSeverityEvents: events.filter((e) => e.severity === "high").length,
  };
};

// ═══════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════

// TC-053 ─────────────────────────────────────────────────────────
describe("Face Detection: Trust Score Penalties", () => {
  test("TC-053: face_not_detected (high severity) should deduct 10 from trust score", () => {
    const severity = getEventSeverity("face_not_detected");
    expect(severity).toBe("high");
    expect(applyTrustScorePenalty(100, severity)).toBe(90);
  });

  // TC-054
  test("TC-054: trust score should never drop below 0, even with a large penalty", () => {
    // 3 high-severity events from 5 → score = 0 after 10 more penalty
    expect(applyTrustScorePenalty(5, "high")).toBe(0);  // 5 - 10 → clamped to 0
    expect(applyTrustScorePenalty(0, "high")).toBe(0);  // already 0
  });
});

// TC-055 ─────────────────────────────────────────────────────────
describe("Face Detection: Event Summary Calculation", () => {
  test("TC-055: face_not_detected event should increment highSeverityEvents count", () => {
    const events = [
      { type: "face_not_detected", severity: "high" },
      { type: "tab_switch",        severity: "medium" },
      { type: "face_not_detected", severity: "high" },
    ];
    const summary = buildEventSummary(events);
    expect(summary.totalEvents).toBe(3);
    expect(summary.highSeverityEvents).toBe(2);
  });
});

// TC-056 ─────────────────────────────────────────────────────────
describe("Face Detection: Event Classification", () => {
  test("TC-056: multiple_faces_detected event should be classified as medium severity", () => {
    expect(getEventSeverity("multiple_faces_detected")).toBe("medium");
  });

});
