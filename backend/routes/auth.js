const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RegistrationAttempt = require("../models/RegistrationAttempt");
const LoginAttempt = require("../models/LoginAttempt");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");
const { signStudentToken } = require("../middleware/auth");
const { authLimiter, preAuthLimiter } = require("../middleware/rateLimiter");

const MAX_REGISTRATION_ATTEMPTS = 3;
const REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ADMIN_ALERT_THRESHOLD = 10;
const ADMIN_ALERT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ROLE_ALIASES = {
  teacher: "coordinator",
  tnpc_admin: "coordinator",
  tnpcadmin: "coordinator",
  "tnpc-admin": "coordinator",
};
const normalizeRole = (role) => {
  const normalized = String(role || "").trim().toLowerCase();
  return ROLE_ALIASES[normalized] || normalized;
};

// Generate 2FA secret
const generate2FASecret = () => {
  return crypto.randomBytes(20).toString("hex");
};

// Generate TOTP code (simplified version)
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

// ─── Registration is CLOSED to the public ───────────────────────────
// Staff accounts are provisioned centrally (super_admin/admin via
// Firebase Admin SDK + Mongo doc in one step) and students come from the
// admin-managed roster. This endpoint now only re-links an ALREADY
// provisioned account (e.g. a staff member whose Firebase login works but
// whose Mongo profile needs a lastLogin refresh). It must never create
// new privileged or student identities from a self-service request.
router.post("/register", authLimiter, verifyFirebaseToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid;

    const user = await User.findOne({ firebaseUid });

    if (user) {
      // Existing provisioned account: refresh lastLogin, never touch role.
      user.lastLogin = new Date();
      await user.save();
      return res.json({ user, message: "User already exists" });
    }

    return res.status(403).json({
      message:
        "Self-registration is disabled. Students are added to the roster by the placement cell; staff accounts are created by an administrator.",
    });
  } catch (error) {
    console.error("Error in register:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── Roster-student login (no Firebase involved) ─────────────────────
// Student enters their ID number (any format, matched case-insensitively)
// OR their college email, plus the shared exam-cell password. Issues a
// backend JWT that middleware/auth.js accepts on every student route.
// Detect account type for the unified login form. Public + rate-limited:
// returns only "student" | "staff", never whether a password is right.
// Anything not found in the roster defaults to "staff" so provisioned
// Firebase accounts keep working; unknown accounts fail in the staff flow
// with Firebase's own error.
router.post("/detect-account", preAuthLimiter, async (req, res) => {
  try {
    const raw = String(req.body?.identifier || "").trim();
    if (!raw) {
      return res.status(400).json({ message: "Identifier is required" });
    }

    const asEmail = raw.toLowerCase();
    const query = raw.includes("@")
      ? { email: asEmail, role: "student" }
      : { idNumberNormalized: raw.toLowerCase(), role: "student" };

    const student = await User.findOne(query).select("_id").lean();
    return res.json({ accountType: student ? "student" : "staff" });
  } catch (error) {
    console.error("Error detecting account:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/student-login", preAuthLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "ID/email and password are required" });
    }

    const id = String(identifier).trim();
    let user;
    if (id.includes("@")) {
      user = await User.findOne({
        email: id.toLowerCase(),
        role: "student",
      }).select("+passwordHash");
    } else {
      user = await User.findOne({
        idNumberNormalized: id.toLowerCase(),
        role: "student",
      }).select("+passwordHash");
    }

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "ID/email or password incorrect" });
    }

    // Every roster student has their own college exam-cell password
    // (bcrypt-hashed at import time). No shared/fallback credential exists.
    if (!user.passwordHash) {
      return res.status(401).json({
        message:
          "No individual password is set for this ID — contact the placement cell to get your exam-cell password added.",
      });
    }
    const passwordOk = await bcrypt.compare(String(password), user.passwordHash);

    if (!passwordOk) {
      await LoginAttempt.create({
        email: (user.email || id).toLowerCase(),
        success: false,
      });
      return res.status(401).json({ message: "ID/email or password incorrect" });
    }

    user.lastLogin = new Date();
    user.failedLoginAttempts = 0;
    user.accountLockedUntil = null;
    await user.save();

    await LoginAttempt.create({
      email: (user.email || id).toLowerCase(),
      success: true,
    });

    const token = signStudentToken(user);
    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        idNumber: user.idNumber,
        batchYear: user.batchYear,
      },
    });
  } catch (error) {
    console.error("Error in student-login:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get current user
router.get("/me", verifyFirebaseToken, async (req, res) => {
  try {
    let user = await User.findOne({ firebaseUid: req.user.uid }).select(
      "-twoFactorSecret",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (normalizeRole(user.role) !== user.role) {
      user.role = normalizeRole(user.role);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    res.json({ user });
  } catch (error) {
    console.error("Error in me:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update user profile
router.put("/profile", verifyFirebaseToken, async (req, res) => {
  try {
    const { name, profileImage, referenceImage } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (profileImage) updateData.profileImage = profileImage;
    if (referenceImage) updateData.referenceImage = referenceImage;

    const user = await User.findOneAndUpdate(
      { firebaseUid: req.user.uid },
      updateData,
      { new: true },
    ).select("-twoFactorSecret");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user, message: "Profile updated" });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Enable 2FA
router.post("/2fa/enable", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: "2FA is already enabled" });
    }

    // Generate secret
    const secret = generate2FASecret();
    user.twoFactorSecret = secret;
    await user.save();

    // In a real app, you would generate a QR code for authenticator apps
    // For simplicity, we'll return the secret directly
    const currentCode = generateTOTP(secret);

    res.json({
      secret,
      message: "Save this secret in your authenticator app",
      // In production, don't send currentCode - it's for testing only
      currentCode,
    });
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Verify and activate 2FA
router.post("/2fa/verify", verifyFirebaseToken, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.twoFactorSecret) {
      return res.status(400).json({ message: "Please enable 2FA first" });
    }

    const expectedCode = generateTOTP(user.twoFactorSecret);

    if (code !== expectedCode) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    user.twoFactorEnabled = true;
    await user.save();

    res.json({ message: "2FA enabled successfully" });
  } catch (error) {
    console.error("Error verifying 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Validate 2FA code during login
router.post("/2fa/validate", verifyFirebaseToken, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.twoFactorEnabled) {
      return res.json({ valid: true, message: "2FA not required" });
    }

    const expectedCode = generateTOTP(user.twoFactorSecret);
    const isValid = code === expectedCode;

    if (!isValid) {
      return res
        .status(401)
        .json({ valid: false, message: "Invalid 2FA code" });
    }

    res.json({ valid: true, message: "2FA verified" });
  } catch (error) {
    console.error("Error validating 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Disable 2FA
router.post("/2fa/disable", verifyFirebaseToken, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: "2FA is not enabled" });
    }

    const expectedCode = generateTOTP(user.twoFactorSecret);

    if (code !== expectedCode) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save();

    res.json({ message: "2FA disabled successfully" });
  } catch (error) {
    console.error("Error disabling 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Check 2FA status
router.get("/2fa/status", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      enabled: user.twoFactorEnabled,
      required: user.twoFactorEnabled,
    });
  } catch (error) {
    console.error("Error checking 2FA status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-18: Check registration lock status ─────────────────────────
// Pre-auth route: IP-limited (no Firebase identity available yet).
router.post("/check-registration", preAuthLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const windowStart = new Date(Date.now() - REGISTRATION_WINDOW_MS);
    const attemptCount = await RegistrationAttempt.countDocuments({
      email: email.toLowerCase(),
      attemptedAt: { $gte: windowStart },
    });

    if (attemptCount >= MAX_REGISTRATION_ATTEMPTS) {
      const oldestAttempt = await RegistrationAttempt.findOne({
        email: email.toLowerCase(),
        attemptedAt: { $gte: windowStart },
      }).sort({ attemptedAt: 1 });

      const retryAfter = new Date(oldestAttempt.attemptedAt.getTime() + REGISTRATION_WINDOW_MS);
      const remainingMs = retryAfter.getTime() - Date.now();

      return res.status(429).json({
        locked: true,
        attemptsUsed: attemptCount,
        maxAttempts: MAX_REGISTRATION_ATTEMPTS,
        retryAfter: retryAfter.toISOString(),
        remainingMs,
        message: "Too many registration attempts. Please try again later.",
      });
    }

    res.json({
      locked: false,
      attemptsUsed: attemptCount,
      maxAttempts: MAX_REGISTRATION_ATTEMPTS,
      remainingAttempts: MAX_REGISTRATION_ATTEMPTS - attemptCount,
    });
  } catch (error) {
    console.error("Error checking registration status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-19: Check login lock status ────────────────────────────────
// Pre-auth route: IP-limited (no Firebase identity available yet).
router.post("/login-status", preAuthLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal whether email exists
      return res.json({ locked: false });
    }

    if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
      const remainingMs = user.accountLockedUntil.getTime() - Date.now();
      return res.status(423).json({
        locked: true,
        lockedUntil: user.accountLockedUntil.toISOString(),
        remainingMs,
        message: "Account is temporarily locked due to too many failed login attempts.",
      });
    }

    res.json({
      locked: false,
      failedAttempts: user.failedLoginAttempts,
      maxAttempts: MAX_LOGIN_FAILURES,
    });
  } catch (error) {
    console.error("Error checking login status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-19: Record login failure ───────────────────────────────────
// Pre-auth route: IP-limited (no Firebase identity available yet). Brute-force
// against a real account is still handled by the account-lockout logic below.
router.post("/login-failure", preAuthLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Record in LoginAttempt collection (for hourly tracking)
    await LoginAttempt.create({ email: email.toLowerCase(), success: false });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.json({ message: "Failure recorded" });
    }

    // If currently locked, just return lock info
    if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
      const remainingMs = user.accountLockedUntil.getTime() - Date.now();
      return res.status(423).json({
        locked: true,
        lockedUntil: user.accountLockedUntil.toISOString(),
        remainingMs,
        message: "Account is temporarily locked due to too many failed login attempts.",
      });
    }

    // Increment failure count
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    // Lock after 5 consecutive failures
    if (user.failedLoginAttempts >= MAX_LOGIN_FAILURES) {
      user.accountLockedUntil = new Date(Date.now() + LOGIN_LOCK_DURATION_MS);
      await user.save();

      const remainingMs = user.accountLockedUntil.getTime() - Date.now();
      // Check for persistent failures (>10 in 1 hour) → admin alert
      const hourAgo = new Date(Date.now() - ADMIN_ALERT_WINDOW_MS);
      const hourlyFailures = await LoginAttempt.countDocuments({
        email: email.toLowerCase(),
        success: false,
        attemptedAt: { $gte: hourAgo },
      });

      if (hourlyFailures >= ADMIN_ALERT_THRESHOLD) {
        // Send alert to all admin users
        const admins = await User.find({
          role: { $in: ["admin", "super_admin"] },
        });
        const notifications = admins.map((admin) => ({
          userId: admin._id,
          type: "account_update",
          title: "Suspicious Login Activity",
          message: `Account ${email} has had ${hourlyFailures} failed login attempts in the last hour. The account has been temporarily locked.`,
          priority: "urgent",
        }));
        if (notifications.length > 0) {
          await Notification.insertMany(notifications);
        }
      }

      return res.status(423).json({
        locked: true,
        lockedUntil: user.accountLockedUntil.toISOString(),
        remainingMs,
        failedAttempts: user.failedLoginAttempts,
        message: "Account locked for 15 minutes due to too many failed login attempts.",
      });
    }

    await user.save();

    res.json({
      locked: false,
      failedAttempts: user.failedLoginAttempts,
      maxAttempts: MAX_LOGIN_FAILURES,
      remainingAttempts: MAX_LOGIN_FAILURES - user.failedLoginAttempts,
      message: `Login failed. ${MAX_LOGIN_FAILURES - user.failedLoginAttempts} attempt(s) remaining before account lock.`,
    });
  } catch (error) {
    console.error("Error recording login failure:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-19: Record login success (reset failure count) ─────────────
router.post("/login-success", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Reset failure tracking on successful login
    user.failedLoginAttempts = 0;
    user.accountLockedUntil = null;
    user.lastLogin = new Date();
    await user.save();

    // Record successful login attempt
    await LoginAttempt.create({ email: user.email.toLowerCase(), success: true });

    res.json({ message: "Login success recorded" });
  } catch (error) {
    console.error("Error recording login success:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
