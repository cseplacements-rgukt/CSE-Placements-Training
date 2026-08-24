import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Button from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import Alert from "../components/ui/Alert";

const FEATURES = [
  "Company-targeted mock tests",
  "Real-time proctored assessments",
  "Instant results & analytics",
  "Run by the CSE Placement Cell",
];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const Login = () => {
  // One login for everyone: students sign in with their roster ID/email and
  // their OWN college exam-cell password; staff with their provisioned email
  // password. The account type is detected automatically — no tabs.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockData, setLockData] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);
  const { studentLogin, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (lockData?.locked && lockData?.remainingMs > 0) {
      setCountdown(Math.ceil(lockData.remainingMs / 1000));
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setLockData(null);
            setError("");
            return null;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [lockData]);

  const formatCountdown = (seconds) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStudentSubmit = async (id, pw) => {
    await studentLogin(id, pw);
    navigate("/dashboard");
  };

  const handleStaffSubmit = async (email, pw) => {
    try {
      await login(email, pw);
      navigate("/dashboard");
    } catch (err) {
      if (err.lockData) {
        setLockData(err.lockData);
        setError(err.message);
      } else if (err.remainingAttempts !== undefined) {
        setError(`Invalid credentials. ${err.remainingAttempts} attempt(s) remaining before account lock.`);
      } else {
        throw err;
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lockData?.locked) return;
    try {
      setError("");
      setLoading(true);

      // Ask the backend which kind of account this identifier belongs to,
      // then run the matching flow — the student/staff choice is automatic.
      let accountType = "staff";
      try {
        const detection = await axios.post(`${API_URL}/auth/detect-account`, {
          identifier: identifier.trim(),
        });
        accountType = detection.data?.accountType || "staff";
      } catch {
        // Detection endpoint unavailable — fall through to staff (Firebase),
        // which produces its own meaningful error for unknown accounts.
      }

      if (accountType === "student") {
        await handleStudentSubmit(identifier.trim(), password);
      } else {
        await handleStaffSubmit(identifier.trim(), password);
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to sign in. Check your ID/email and password.",
      );
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockData?.locked && countdown > 0;

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* ── Left Brand Panel ────────────────────────────── */}
      <div className="hidden w-[42%] max-w-xl flex-col justify-between bg-primary p-10 text-white lg:flex xl:p-14">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-[15px] font-bold">
            CP
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">CSE Placements</div>
            <div className="text-[13px] text-stone-400">Training Platform</div>
          </div>
        </div>

        <div>
          <h2 className="max-w-md text-[26px] font-bold leading-snug tracking-tight">
            Prepare smarter. Place better.
          </h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-stone-400">
            Your college's dedicated portal for company-specific mock tests,
            structured practice, and placement readiness.
          </p>
        </div>

        <ul className="space-y-3.5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-3 text-sm text-stone-300">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Right Form Panel ────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* Mobile-only brand */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-[15px] font-bold text-white">
              CP
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-ink">CSE Placements Training</div>
              <div className="text-[13px] text-ink-muted">Mock Test Portal</div>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-6 shadow-sm sm:p-8">
            <h1 className="text-[22px] font-bold tracking-tight text-ink">Welcome back</h1>
            <p className="mt-1 mb-6 text-sm text-ink-muted">
              Students and staff sign in here — your dashboard opens automatically.
            </p>

            {error && (
              <Alert variant="error" className="mb-4">
                {error}
              </Alert>
            )}
            {isLocked && (
              <Alert variant="warning" title="Account temporarily locked" className="mb-4">
                <p className="mt-1 text-2xl font-bold tabular-nums">{formatCountdown(countdown)}</p>
                <p className="mt-0.5 text-[13px] opacity-80">
                  You can try again when the timer expires.
                </p>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                id="login-identifier"
                label="ID Number or Email"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. s210574 · s210574@rguktsklm.ac.in · staff@email.com"
                autoComplete="username"
                required
                disabled={loading || isLocked}
                hint="Students: the ID given on your roster — letters like s/o/n/r all work."
              />
              <Input
                id="login-password"
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your exam-cell / account password"
                autoComplete="current-password"
                required
                disabled={loading || isLocked}
                hint="Students: use your college exam-cell password (the one for email & results)."
              />
              <Button type="submit" size="lg" className="w-full" disabled={loading || isLocked}>
                {loading ? "Signing in…" : isLocked ? "Account Locked" : "Sign In"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
