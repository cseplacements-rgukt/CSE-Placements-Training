const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

// ── Store decision (RGUKT / Hostinger VPS deployment) ───────────────────────
// These limiters use express-rate-limit's default in-memory store. That is a
// deliberate, documented choice: the production deployment runs PM2 in FORK
// mode (a single Node process) precisely so per-user limits stay correct.
//
// DO NOT switch PM2 to cluster mode or run multiple instances behind a load
// balancer without first moving these limiters to a shared Redis store
// (`rate-limit-redis` reusing the existing ioredis connection), otherwise
// every worker multiplies each student's effective limit.

const userKey = (req) => req.user?.uid || `ip:${ipKeyGenerator(req.ip)}`;

// Kept as a no-op export for compatibility.  A campus-wide IP limiter is not
// appropriate for an exam: hundreds of students can share one NAT address.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100000,
  keyGenerator: userKey,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for authentication routes - 5 requests per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// These limiters run after Firebase authentication and therefore isolate one
// student rather than penalising everyone on a shared public IP.
const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: userKey,
  message: 'Too many submission attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const autoSaveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  keyGenerator: userKey,
  message: 'Too many autosave requests, please try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
});

const proctoringEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: userKey,
  message: 'Too many proctoring events, please try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Exam code join limiter — per authenticated user, not per IP.
// 10 per minute is generous for legitimate use but prevents brute-force.
const examCodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: userKey,
  message: 'Too many exam code attempts, please try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
});

// IP-based limiter for the three PRE-AUTH routes (/auth/check-registration,
// /auth/login-status, /auth/login-failure, /auth/detect-account,
// /auth/student-login). These run before Firebase auth, so there is no user
// identity yet and per-IP is the only available key.
//
// Sizing note: a campus NAT means hundreds of students share one public IP.
// A 200-student cohort logging in within minutes generates 400+ pre-auth
// calls (detect-account + student-login per student, plus retries), so the
// cap must sit well above that while still stopping scripted
// email-enumeration loops (which issue thousands of calls per minute).
const preAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: 'Too many requests from this network, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  authLimiter,
  submissionLimiter,
  autoSaveLimiter,
  proctoringEventLimiter,
  examCodeLimiter,
  preAuthLimiter,
};
