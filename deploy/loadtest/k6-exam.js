/**
 * k6 load test — MOD-U-GO exam session simulation for RGUKT scale.
 *
 * Simulates a REAL exam session per virtual student (not just GET /health):
 *   join code → start submission → 30s±jitter delta autosaves →
 *   batched proctoring events → final-submit burst at scenario end.
 *
 * Ramp: 25 → 50 → 100 → 150 → 200 → 250 concurrent VUs.
 *
 * Prerequisites:
 *   1. One published exam with a known code in the target DB.
 *   2. Mint tokens:  node mint-tokens.js   (see header of that file)
 *
 * Run:
 *   k6 run \
 *     -e BASE_URL=https://exam.yourdomain.edu/api \
 *     -e EXAM_CODE=ABC123 \
 *     deploy/loadtest/k6-exam.js
 *
 * Optional knobs: STEP_DURATION (default 60s), SESSION_SECONDS (default 120),
 * AUTOSAVE_INTERVAL (default 30), SUBMIT_BURST (default true).
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000/api";
const EXAM_CODE = (__ENV.EXAM_CODE || "").toUpperCase();
const STEP = __ENV.STEP_DURATION || "60s";
const SESSION_SECONDS = parseInt(__ENV.SESSION_SECONDS || "120", 10);
const AUTOSAVE_INTERVAL = parseInt(__ENV.AUTOSAVE_INTERVAL || "30", 10);
const DO_SUBMIT_BURST = (__ENV.SUBMIT_BURST || "true") !== "false";

// ── Metrics ──────────────────────────────────────────────────────────────────
const autosaveDuration = new Trend("autosave_duration", true);
const proctorBatchDuration = new Trend("proctbatch_duration", true);
const submitDuration = new Trend("submit_duration", true);
const startExamDuration = new Trend("startexam_duration", true);
const rateLimited = new Counter("http_429_total");
const serverErrors = new Counter("http_5xx_total");

export const options = {
  scenarios: {
    ramping_students: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: STEP, target: 25 },
        { duration: STEP, target: 25 },
        { duration: STEP, target: 50 },
        { duration: STEP, target: 50 },
        { duration: STEP, target: 100 },
        { duration: STEP, target: 150 },
        { duration: STEP, target: 200 },
        { duration: STEP, target: 250 },
        { duration: "90s", target: 250 }, // sustained peak window
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // Acceptance bar from DEPLOYMENT.md §6
    "http_req_duration{scenario:ramping_students}": ["p(95)<1500"],
    autosave_duration: ["p(95)<300", "p(99)<800"],
    submit_duration: ["p(95)<1500"],
    proctbatch_duration: ["p(95)<300"],
    checks: ["rate>0.99"],
  },
  discardResponseBodies: false,
};

let tokens = [];

export function setup() {
  if (!EXAM_CODE) throw new Error("EXAM_CODE env var is required");
  try {
    tokens = JSON.parse(open("./tokens.json"));
  } catch (e) {
    throw new Error("deploy/loadtest/tokens.json missing — run mint-tokens.js first");
  }
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new Error("tokens.json contains no tokens");
  }
  console.log(`Loaded ${tokens.length} tokens; target=${BASE_URL} code=${EXAM_CODE}`);
}

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, tags: { name: "" } };
}

function track(res, trend) {
  if (res.status === 429) rateLimited.add(1);
  if (res.status >= 500) serverErrors.add(1);
  if (trend) trend.add(res.timings.duration);
  return res;
}

export default function () {
  const token = tokens[exec.scenario.iterationInTest % tokens.length];
  const vuId = exec.vu.idInTest;

  group("join + start exam", () => {
    const joinRes = track(http.post(`${BASE_URL}/exams/join`, JSON.stringify({ examCode: EXAM_CODE }), authHeaders(token)));
    check(joinRes, { "join 200": (r) => r.status === 200 });
    if (joinRes.status !== 200) { sleep(5); return; }
    const examId = joinRes.json("exam._id");

    sleep(1 + Math.random() * 3); // reading instructions

    const startRes = track(
      http.post(`${BASE_URL}/submissions/start`, JSON.stringify({ examId, examCode: EXAM_CODE }), authHeaders(token)),
      startExamDuration
    );
    const okStart = check(startRes, { "start 201": (r) => r.status === 201 });
    if (!okStart && startRes.status !== 200) { sleep(5); return; }

    const questions = (startRes.json("exam.questions") || []).map((q) => q._id);
    if (questions.length === 0) { sleep(5); return; }
    const submissionId = startRes.json("submission._id");

    group("exam session (autosave + proctoring)", () => {
      const dirty = {};
      const startedAt = Date.now();
      let nextAutosaveAt = startedAt + Math.random() * 5000 + AUTOSAVE_INTERVAL * 1000; // jittered first save
      let nextProctorAt = startedAt + 8000 + Math.random() * 4000;
      let answerCursor = Math.floor(Math.random() * questions.length);

      while ((Date.now() - startedAt) / 1000 < SESSION_SECONDS) {
        const now = Date.now();

        if (now >= nextAutosaveAt) {
          // Student answered 1-3 more questions since the last save
          for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) {
            const qid = questions[answerCursor % questions.length];
            dirty[qid] = `Answer text ${answerCursor}-${vuId}`;
            answerCursor++;
          }
          const changes = Object.entries(dirty).map(([questionId, answer]) => ({ questionId, answer }));
          const res = track(
            http.post(`${BASE_URL}/submissions/auto-save`, JSON.stringify({ submissionId, changes }), authHeaders(token)),
            autosaveDuration
          );
          check(res, { "autosave ok": (r) => r.status === 200 });
          if (res.status === 200) Object.keys(dirty).forEach((k) => delete dirty[k]);
          nextAutosaveAt = now + AUTOSAVE_INTERVAL * 1000 + Math.random() * 5000;
        }

        if (now >= nextProctorAt) {
          const n = 1 + Math.floor(Math.random() * 4); // low-severity coalesced events
          const events = Array.from({ length: n }, (_, i) => ({
            type: i % 2 === 0 ? "focus_returned" : "right_click",
            severity: "low",
            details: "loadtest",
            clientTimestamp: new Date().toISOString(),
          }));
          // Session must be created first via /proctoring/start
          if (!globalThis.__sess) {
            const sessRes = http.post(`${BASE_URL}/proctoring/start`, JSON.stringify({ examId, submissionId, deviceInfo: { browser: "k6" } }), authHeaders(token));
            globalThis.__sess = sessRes.status === 201 ? sessRes.json("session._id") : null;
          }
          if (globalThis.__sess) {
            const res = track(
              http.post(`${BASE_URL}/proctoring/events/batch`, JSON.stringify({ sessionId: globalThis.__sess, events }), authHeaders(token)),
              proctorBatchDuration
            );
            check(res, { "proctor batch ok": (r) => r.status === 200 });
          }
          nextProctorAt = now + 8000 + Math.random() * 4000;
        }

        sleep(1);
      }
    });

    if (DO_SUBMIT_BURST) {
      const res = track(
        http.post(`${BASE_URL}/submissions`, JSON.stringify({ examId, submissionId, answers: [], tabSwitchCount: 1, fullscreenExitCount: 0 }), authHeaders(token)),
        submitDuration
      );
      check(res, { "submit accepted": (r) => r.status === 201 });
    }

    // End the proctoring session and clear per-VU state for the next iteration
    if (globalThis.__sess) {
      http.post(`${BASE_URL}/proctoring/end`, JSON.stringify({ sessionId: globalThis.__sess }), authHeaders(token));
      globalThis.__sess = null;
    }
  });

  sleep(2);
}
