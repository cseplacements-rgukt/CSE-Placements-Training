import React, { useState, useEffect, useRef, useCallback, useMemo, memo, lazy, Suspense } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { examService } from "../services/examService";
import { RichContent, RichInline, QuestionBody } from "../components/RichContent";
import ExamTimer from "../components/ExamTimer";
import GazeTracker from "../components/GazeTracker";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { LoadingScreen } from "../components/ui/Spinner";
import { buildSectionGroups, sectionNamesById } from "../lib/examSections";
import { loadFaceApi } from "../lib/faceApi";

const CalibrationScreen = lazy(() => import("../components/CalibrationScreen"));

const VIDEO_STYLE = {
  width: "160px",
  height: "120px",
  objectFit: "cover",
  borderRadius: "8px",
  background: "#000",
};

const DIFFICULTY_BADGE = {
  easy: "success",
  medium: "warning",
  hard: "danger",
};

const PALETTE_BASE =
  "flex h-9 w-9 items-center justify-center rounded-sm border text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

// Numbered navigation grid. `indices` selects a subset of the flat question
// array (one section) while keeping the global 1..N numbering intact.
const PaletteGrid = memo(function PaletteGrid({
  questions,
  indices,
  answers,
  currentQuestion,
  allowBackNav,
  onSelect,
}) {
  return (
    <div className="grid grid-cols-8 gap-1.5 lg:grid-cols-5">
      {(indices || questions.map((_, i) => i)).map((index) => {
        const q = questions[index];
        const isCurrent = index === currentQuestion;
        const isAnswered = answers[q._id] && String(answers[q._id]).trim() !== "";
        const disabled = !allowBackNav && index < currentQuestion;
        let cls;
        if (isCurrent) {
          cls = "border-primary bg-primary text-white";
        } else if (disabled) {
          cls = "border-line bg-surface text-stone-300 cursor-not-allowed";
        } else if (isAnswered) {
          cls = "border-green-300 bg-green-50 text-green-700 hover:border-success";
        } else {
          cls = "border-line bg-surface text-ink-muted hover:border-stone-300 hover:bg-canvas";
        }
        return (
          <button
            key={q._id}
            type="button"
            onClick={() => onSelect(index)}
            disabled={disabled}
            aria-label={`Go to question ${index + 1}${isAnswered ? " (answered)" : ""}${isCurrent ? " (current)" : ""}`}
            aria-current={isCurrent ? "true" : undefined}
            className={`${PALETTE_BASE} ${cls}`}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
});

const QuestionCard = memo(function QuestionCard({
  question,
  index,
  total,
  answer,
  onAnswerChange,
  sectionName,
}) {
  const getWordCount = (text) =>
    text ? text.trim().split(/\s+/).filter((word) => word.length > 0).length : 0;

  const wordCount = getWordCount(answer);
  const wordLimit = question.constraints?.wordLimit;
  const overLimit = wordLimit && wordCount > wordLimit;

  const difficulty = question.constraints?.difficultyLevel;

  return (
    <div className="rounded-md border border-line bg-surface shadow-sm">
      <div className="border-b border-line px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">
            Question {index + 1}{" "}
            <span className="font-normal text-ink-muted">of {total}</span>
          </h2>
          <div className="flex items-center gap-1.5">
            {sectionName && <Badge variant="neutral">{sectionName}</Badge>}
            {difficulty && (
              <Badge variant={DIFFICULTY_BADGE[difficulty] || "neutral"}>
                {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
              </Badge>
            )}
            {question.type !== "mcq" && question.type !== "fill_blank" && wordLimit && (
              <Badge variant="neutral">Max {wordLimit} words</Badge>
            )}
            <span className="text-[13px] font-medium text-ink-muted">
              {question.points} pt{question.points !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="text-[15px] leading-relaxed text-ink [&_p]:!mb-0">
          <QuestionBody question={question} />
        </div>

        {(question.type === "mcq" ||
          question.type === "true_false") &&
          Array.isArray(question.options) && (
            <fieldset className="mt-5 space-y-2.5">
              <legend className="sr-only">Answer options</legend>
              {question.options.map((option, optIndex) => {
                const selected = answer === option;
                return (
                  <label
                    key={optIndex}
                    className={`flex cursor-pointer items-center gap-3 rounded-sm border px-4 py-3 text-sm transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 ${
                      selected
                        ? "border-accent bg-accent-light/60 text-ink"
                        : "border-line bg-surface text-ink hover:border-stone-300 hover:bg-canvas"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`question-${question._id}`}
                      value={option}
                      checked={selected}
                      onChange={(e) => onAnswerChange(question._id, e.target.value)}
                      className="h-4 w-4 shrink-0 accent-[#b45309]"
                    />
                    <RichInline text={option} />
                  </label>
                );
              })}
            </fieldset>
          )}

        {(question.type === "short_answer" || question.type === "essay") && (
          <div className="mt-5">
            <textarea
              key={`answer-${question._id}`}
              className="w-full rounded-sm border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink transition-colors placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              value={answer || ""}
              onChange={(e) => onAnswerChange(question._id, e.target.value)}
              placeholder="Type your answer here..."
              rows={question.type === "essay" ? 8 : 4}
            />
            <div className="mt-1.5 flex justify-end">
              <span
                className={`text-xs tabular-nums ${overLimit ? "font-medium text-danger" : "text-ink-muted"}`}
                aria-live="polite"
              >
                Words: {wordCount}
                {wordLimit ? ` / ${wordLimit}` : ""}
                {overLimit ? " — over the limit" : ""}
              </span>
            </div>
          </div>
        )}

        {question.type === "fill_blank" && (
          <input
            type="text"
            className="mt-5 h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink transition-colors placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            value={answer || ""}
            onChange={(e) => onAnswerChange(question._id, e.target.value)}
            placeholder="Fill in the blank"
          />
        )}
      </div>
    </div>
  );
});

const TakeExam = () => {
  const { examId } = useParams();
  const location = useLocation();
  const examCode = location.state?.examCode || "";
  const { getAuthToken } = useAuth();
  const navigate = useNavigate();

  const [exam, setExam] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [proctoringSession, setProctoringSession] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const tabSwitchCountRef = useRef(0);
  const [fullscreenExitCount, setFullscreenExitCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusWarning, setFocusWarning] = useState(null);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [trustScore, setTrustScore] = useState(100);
  const [showInstructions, setShowInstructions] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [calibrationRequired, setCalibrationRequired] = useState(false);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const [faceStatus, setFaceStatus] = useState("idle"); // idle|ok|no_face|multiple_faces|looking_away
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [examEndAt, setExamEndAt] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const autoSaveIntervalRef = useRef(null);
  const focusWarningTimerRef = useRef(null);
  const examRef = useRef(null);
  const submittingRef = useRef(false);
  // Set once the server accepts a submission — blocks any further submit
  // attempt (e.g. a time-up auto-submit firing while the success dialog is
  // open) without disabling UI interaction.
  const submittedRef = useRef(false);
  const proctoringSessionRef = useRef(null);
  const focusLostAtRef = useRef(null);
  const monitoringEnabledRef = useRef(false);
  const fullscreenRequiredRef = useRef(true); // From exam settings; stable for callbacks
  const streamRef = useRef(null); // Holds the raw MediaStream so we can stop it reliably
  const faceDetectionIntervalRef = useRef(null);
  const faceModelsLoadedRef = useRef(false); // Tracks whether face-api models are loaded
  const lastFaceEventRef = useRef({}); // Per-event cooldown timestamps
  const faceConditionSinceRef = useRef({});
  const faceBadSinceRef = useRef(null); // Sustained-bad-condition tracker (pill hysteresis)
  const faceOkSinceRef = useRef(null); // Sustained-ok tracker (prevents flicker on recovery)
  const gazeTrackerRef = useRef(null); // WebGazer-based gaze deviation tracker
  const answersRef = useRef({});
  const dirtyAnswersRef = useRef(new Map());
  const autoSaveInFlightRef = useRef(false);
  const autoSaveRetryRef = useRef(null);
  const consecutiveSaveFailuresRef = useRef(0);
  const eventQueueRef = useRef([]);
  const eventFlushTimerRef = useRef(null);
  const flushInFlightRef = useRef(false);
  const lastTabViolationAtRef = useRef(0);
  // Epoch ms when violation monitoring switched ON. Fullscreen drops caused by
  // camera-permission prompts / WebGazer's own getUserMedia fire right after
  // calibration — inside this grace window they are silently repaired instead
  // of being logged as cheating violations at the very start of the test.
  const monitoringStartedAtRef = useRef(0);
  const FULLSCREEN_SETTLE_GRACE_MS = 12000;
  // Programmatic re-entry is blocked ~1.25 s after an Esc-initiated exit
  // (browser security cooldown) — retry once past that window.
  const fullscreenRestoreTimersRef = useRef([]);
  // In-app dialog (never window.alert/confirm — native popups drop fullscreen
  // and cause false violations). The pending Promise resolver lives in a ref.
  const [dialog, setDialog] = useState(null); // { kind: "confirm"|"notice", title, message, confirmLabel, tone }
  const dialogResolveRef = useRef(null);
  const dialogActiveRef = useRef(false); // Mirror of `dialog` for stable callbacks
  const [loadError, setLoadError] = useState(null);
  // Minimum-time floor: epoch ms when Submit unlocks (null = no floor).
  const [submitUnlockAt, setSubmitUnlockAt] = useState(null);
  const [, setGateTick] = useState(0); // re-render once per second while gated

  // Load exam data on mount (for instructions screen)
  useEffect(() => {
    loadExamData();
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Start the exam when user dismisses instructions
  useEffect(() => {
    if (!showInstructions && exam) {
      startExamSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInstructions]);

  useEffect(() => {
    examRef.current = exam;
  }, [exam]);

  useEffect(() => {
    proctoringSessionRef.current = proctoringSession;
  }, [proctoringSession]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  // Keep a ref mirror of the dialog flag for stable monitoring callbacks.
  // While an in-app dialog is open, Esc may legitimately drop fullscreen to
  // dismiss it — that is not a cheating signal.
  useEffect(() => {
    dialogActiveRef.current = !!dialog;
  }, [dialog]);

  // Heal any race where the webcam stream started before the <video> element
  // was mounted (e.g. right after calibration): attach it as soon as both exist.
  // Intentionally runs on every render — the srcObject guard makes it a no-op
  // once attached, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const video = videoRef.current;
    if (streamRef.current && video && !video.srcObject) {
      video.srcObject = streamRef.current;
      setWebcamEnabled(true);
    }
  });

  // While the submit gate is active, tick once per second so the Submit
  // button label counts down. The interval exists only while gated.
  useEffect(() => {
    if (!submitUnlockAt || Date.now() >= submitUnlockAt) return undefined;
    const timer = setInterval(() => setGateTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [submitUnlockAt]);

  // ── Section-aware navigation palette ────────────────────────────────────
  // exam.questions is one flat array; sections are display buckets over it.
  const sectionGroups = useMemo(
    () => (exam ? buildSectionGroups(exam.questions || [], exam.sections) : []),
    [exam],
  );

  const sectionNameById = useMemo(
    () => sectionNamesById(exam?.sections),
    [exam],
  );

  const [openSections, setOpenSections] = useState(() => new Set());

  // The section holding the current question is always expanded, so students
  // never land inside a collapsed group when navigating via Prev/Next.
  const activeSectionKey = useMemo(() => {
    for (const group of sectionGroups) {
      if (group.indices.includes(currentQuestion)) return group.key;
    }
    return null;
  }, [sectionGroups, currentQuestion]);

  useEffect(() => {
    if (!activeSectionKey) return;
    setOpenSections((prev) =>
      prev.has(activeSectionKey) ? prev : new Set(prev).add(activeSectionKey),
    );
  }, [activeSectionKey]);

  const toggleSectionOpen = useCallback((key) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // ── Fullscreen restore helpers ────────────────────────────────────────────
  const clearRestoreTimers = useCallback(() => {
    fullscreenRestoreTimersRef.current.forEach(clearTimeout);
    fullscreenRestoreTimersRef.current = [];
  }, []);

  // Schedule programmatic re-entry attempts. Chrome refuses requestFullscreen
  // for ~1.25 s after an Esc-initiated exit, so one early attempt (covers
  // permission-prompt drops) is followed by a post-cooldown attempt. Every
  // call is guarded by submitting/dialog state inside requestFullscreen paths.
  const scheduleFullscreenRestore = useCallback(() => {
    if (!fullscreenRequiredRef.current) return;
    clearRestoreTimers();
    [600, 1800].forEach((delay) => {
      fullscreenRestoreTimersRef.current.push(
        setTimeout(() => {
          if (
            !submittingRef.current &&
            !dialogActiveRef.current &&
            !document.fullscreenElement &&
            !document.webkitFullscreenElement &&
            !document.msFullscreenElement
          ) {
            requestFullscreen();
          }
        }, delay),
      );
    });
  }, [clearRestoreTimers]);

  // ── In-app dialogs (promise-based replacements for alert/confirm) ────────
  const showConfirm = useCallback(({ title, message, confirmLabel = "Confirm", tone = "primary" }) => {
    return new Promise((resolve) => {
      dialogResolveRef.current = resolve;
      setDialog({ kind: "confirm", title, message, confirmLabel, tone });
    });
  }, []);

  const showNotice = useCallback(({ title, message, confirmLabel = "OK", tone = "info" }) => {
    return new Promise((resolve) => {
      dialogResolveRef.current = resolve;
      setDialog({ kind: "notice", title, message, confirmLabel, tone });
    });
  }, []);

  const settleDialog = useCallback((result) => {
    setDialog(null);
    const resolve = dialogResolveRef.current;
    dialogResolveRef.current = null;
    resolve?.(result);
  }, []);

  // EventMonitor: showFocusWarning
  // Displays a timed on-screen warning banner and auto-dismisses after 5 s.
  const showFocusWarning = useCallback((message) => {
    setFocusWarning(message);
    if (focusWarningTimerRef.current) clearTimeout(focusWarningTimerRef.current);
    focusWarningTimerRef.current = setTimeout(() => setFocusWarning(null), 5000);
  }, []);

  // ── Timer milestone / expiry handlers (stable identity for ExamTimer) ──
  const handleTimeMilestone = useCallback(
    (seconds) => {
      showFocusWarning(
        seconds <= 60
          ? "Warning: 1 minute remaining!"
          : "Warning: 5 minutes remaining!"
      );
    },
    [showFocusWarning]
  );

  const handleTimeUp = useCallback(() => {
    setTimeUp(true);
    const activeExam = examRef.current;
    if (activeExam?.settings?.autoSubmitOnTimeUp !== false) {
      handleSubmitRef.current?.(true);
    }
  }, []);

  // Load exam data for instructions screen
  const loadExamData = async () => {
    try {
      const token = await getAuthToken();
      const examData = await examService.getExam(token, examId);
      setExam(examData.exam);
    } catch (error) {
      console.error("Error loading exam:", error);
      setLoadError(
        "Could not load this exam: " +
        (error.response?.data?.message || error.message),
      );
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const normalizeExamQuestions = (fetchedExam) => {
    if (!fetchedExam) return null;
    return {
      ...fetchedExam,
      questions: fetchedExam.questions ? fetchedExam.questions.map(q => ({
        ...q,
        options: q.type === 'mcq' ? (Array.isArray(q.options) ? q.options : []) : undefined
      })) : undefined
    };
  };

  // Start the actual exam session after instructions
  const startExamSession = async () => {
    try {
      setLoading(true);
      const token = await getAuthToken();
      const submissionData = await examService.startExam(token, examId, examCode);
      setSubmission(submissionData.submission);

      // The backend returns the exam object with questions populated when starting
      if (submissionData.exam) {
        setExam(normalizeExamQuestions(submissionData.exam));
      }

      const activeExam = normalizeExamQuestions(submissionData.exam) || exam;

      // ── Timer calculation (Server Authoritative) ──
      const startedAt = new Date(submissionData.submission.startedAt);
      const individualEndTime = new Date(startedAt.getTime() + activeExam.duration * 60000);
      const globalEndTime = new Date(activeExam.endTime);
      const finalEndTime = individualEndTime < globalEndTime ? individualEndTime : globalEndTime;

      setExamEndAt(finalEndTime.getTime());

      // Minimum-time floor for the Submit button (server enforces it too).
      const minMinutes = Number(activeExam.settings?.minDurationMinutes) || 0;
      setSubmitUnlockAt(minMinutes > 0 ? startedAt.getTime() + minMinutes * 60000 : null);

      const initialAnswers = {};
      if (
        submissionData.submission.answers &&
        submissionData.submission.answers.length > 0
      ) {
        submissionData.submission.answers.forEach((a) => {
          initialAnswers[a.questionId] = a.answer || "";
        });
      } else if (activeExam && activeExam.questions) {
        activeExam.questions.forEach((q) => {
          initialAnswers[q._id] = "";
        });
      }
      setAnswers(initialAnswers);
      answersRef.current = initialAnswers;
      dirtyAnswersRef.current.clear();
      tabSwitchCountRef.current = submissionData.submission.tabSwitchCount || 0;
      setTabSwitchCount(submissionData.submission.tabSwitchCount || 0);
      setFullscreenExitCount(
        submissionData.submission.fullscreenExitCount || 0,
      );

      // Check if submission is already locked (page reload scenario)
      if (submissionData.submission.status === "locked") {
        setIsLocked(true);
        setLockReason(
          submissionData.submission.lockInfo?.lockReason ||
          "Your exam has been locked due to violations.",
        );
        return;
      }

      // A proctoring session must exist for every exam so trust score and
      // violation tracking always work; only the camera pipeline depends
      // on requireWebcam (handled inside startProctoring).
      await startProctoring(token, activeExam, submissionData.submission._id);

      // Honor the exam's fullscreen setting (default: required). When not
      // required, no request and no exit-violation logging happen at all.
      const fsRequired = activeExam.settings?.requireFullscreen !== false;
      fullscreenRequiredRef.current = fsRequired;
      if (fsRequired) {
        requestFullscreen();
      }

      setupMonitoring();

      // Jitter prevents all students from autosaving in the same second.
      window.setTimeout(() => {
        performAutoSave();
        autoSaveIntervalRef.current = setInterval(performAutoSave, 30000);
      }, Math.floor(Math.random() * 5000));
    } catch (error) {
      console.error("Error starting exam:", error);
      setLoadError(
        "Could not start this exam: " +
        (error.response?.data?.message || error.message),
      );
    } finally {
      setLoading(false);
    }
  };

  const startProctoring = async (token, examParam, submissionId) => {
    try {
      const deviceInfo = {
        browser: navigator.userAgent,
        os: navigator.platform,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
      };

      const response = await examService.startProctoringSession(
        token,
        examParam?._id,
        submissionId,
        deviceInfo,
      );
      setProctoringSession(response.session);

      // Show calibration screen if camera is required
      if (examParam?.settings?.requireWebcam !== false) {
        setCalibrationRequired(true);
      } else {
        // Camera not required: skip calibration and never touch getUserMedia,
        // but monitoring (tab switches, focus loss, trust score) still runs.
        setCalibrationComplete(true);
        monitoringEnabledRef.current = true;
        monitoringStartedAtRef.current = Date.now();
      }
    } catch (error) {
      console.error("Error starting proctoring:", error);
      // Session creation failed — still arm local monitoring so tab switches
      // and focus loss are counted (and sent with the submission) even if
      // the server-side score sync is unavailable.
      setCalibrationComplete(true);
      monitoringEnabledRef.current = true;
      monitoringStartedAtRef.current = Date.now();
    }
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 320, height: 240 },
        audio: false,
      });

      // Keep the stream in a ref so cleanup() can always stop it,
      // even if videoRef.current becomes null during navigation.
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setWebcamEnabled(true);
      }
    } catch (error) {
      console.error("Error starting webcam:", error);
      logProctoringEvent("webcam_disabled", "high", "Failed to access webcam");
    }
  };

  // ─── Live AI Face Detection ─────────────────────────────────────────────────

  const ensureModelsLoaded = async () => {
    if (faceModelsLoadedRef.current) return;
    const faceapi = await loadFaceApi();
    const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
    await Promise.all([
      faceapi.nets.tinyFaceDetector.load(MODEL_URL),
      faceapi.nets.faceLandmark68Net.load(MODEL_URL),
    ]);
    faceModelsLoadedRef.current = true;
  };

  // ─── Live Face Detection ───────────────────────────────────────────────────
  //
  // Deliberately tolerant: blinks (~150 ms), reading saccades and natural
  // head posture must NOT flash "Look at screen". A condition therefore has
  // to PERSIST for FACE_BAD_SUSTAIN_MS before the status pill flips, and the
  // proctoring event only fires after its own longer sustain + cooldown.
  const FACE_BAD_SUSTAIN_MS = 3000;
  const FACE_OK_SUSTAIN_MS = 1000;

  const analyzeFaceDetection = async () => {
    if (!videoRef.current || submittingRef.current) return;
    try {
      const faceapi = await loadFaceApi();
      const detections = await faceapi
        .detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
        .withFaceLandmarks();

      const count = detections.length;
      const now = Date.now();

      // Log an event type at most once per cooldown period
      const canLog = (type, ms = 20000) => {
        const last = lastFaceEventRef.current[type] || 0;
        if (now - last >= ms) { lastFaceEventRef.current[type] = now; return true; }
        return false;
      };

      let frameVerdict = null; // "ok" | "no_face" | "multiple_faces" | reason string

      if (count === 0) {
        frameVerdict = "no_face";
        faceConditionSinceRef.current.face_not_detected ||= now;
        if (now - faceConditionSinceRef.current.face_not_detected >= 5000 && canLog("face_not_detected")) {
          logProctoringEvent("face_not_detected", "high", "No face detected in frame");
        }
      } else if (count > 1) {
        frameVerdict = "multiple_faces";
        faceConditionSinceRef.current.multiple_faces ||= now;
        if (now - faceConditionSinceRef.current.multiple_faces >= 5000 && canLog("multiple_faces")) {
          logProctoringEvent("multiple_faces", "high", `${count} faces detected simultaneously`);
        }
      } else {
        faceConditionSinceRef.current = {};
        const pts = detections[0].landmarks.positions;
        const box = detections[0].detection.box;

        // Helper: average coordinate for a set of landmark indices
        const mx = (idx) => idx.reduce((s, i) => s + pts[i].x, 0) / idx.length;
        const my = (idx) => idx.reduce((s, i) => s + pts[i].y, 0) / idx.length;

        // Eye centers (left: 36-41, right: 42-47)
        const leftEyeIdx = [36, 37, 38, 39, 40, 41];
        const rightEyeIdx = [42, 43, 44, 45, 46, 47];
        const eyeMidX = (mx(leftEyeIdx) + mx(rightEyeIdx)) / 2;
        const eyeMidY = (my(leftEyeIdx) + my(rightEyeIdx)) / 2;

        // Horizontal head turn: nose tip (33) vs eye center
        const headTurnRatioH = Math.abs(pts[33].x - eyeMidX) / box.width;

        // Vertical head tilt: nose tip vs eye center (detects looking up/down)
        const headTurnRatioV = Math.abs(pts[33].y - eyeMidY) / box.height;

        // Eye Aspect Ratio – detects closed eyes. Open eyes sit ≈0.25–0.40,
        // a blink dips below ≈0.10 — so only a genuinely shut/rolled-away
        // eye crosses this line. Reading with a lowered gaze stays ~0.15+.
        const d = (a, b) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
        const leftEAR = (d(37, 41) + d(38, 40)) / (2 * d(36, 39));
        const rightEAR = (d(43, 47) + d(44, 46)) / (2 * d(42, 45));
        const avgEAR = (leftEAR + rightEAR) / 2;

        // Iris position ratio — detects sustained sideways staring without
        // head turn. Eye movements while reading reach ±0.15 routinely, so
        // the threshold sits well above that.
        const leftIrisX = mx([37, 38]);
        const leftIrisRatio = (leftIrisX - pts[36].x) / (pts[39].x - pts[36].x || 1);
        const rightIrisX = mx([43, 44]);
        const rightIrisRatio = (rightIrisX - pts[42].x) / (pts[45].x - pts[42].x || 1);
        const avgIrisRatio = (leftIrisRatio + rightIrisRatio) / 2;
        const irisDeviation = Math.abs(avgIrisRatio - 0.5);

        if (headTurnRatioH > 0.25) {
          frameVerdict = `Head turned sideways (${Math.round(headTurnRatioH * 100)}% offset)`;
        } else if (headTurnRatioV > 0.45) {
          frameVerdict = `Head tilted away (${Math.round(headTurnRatioV * 100)}% offset)`;
        } else if (irisDeviation > 0.24) {
          frameVerdict = `Eyes fixed sideways (iris offset: ${irisDeviation.toFixed(2)})`;
        } else if (avgEAR < 0.10) {
          frameVerdict = `Eyes fully closed (EAR: ${avgEAR.toFixed(2)})`;
        } else {
          frameVerdict = "ok";
        }
      }

      // ── Hysteresis: only apply sustained conditions to the status pill ──
      if (frameVerdict === "ok") {
        faceBadSinceRef.current = null;
        faceOkSinceRef.current ||= now;
        if (now - faceOkSinceRef.current >= FACE_OK_SUSTAIN_MS) {
          setFaceStatus("ok");
        }
        // While recovering we keep the previous status briefly — avoids flicker.
      } else {
        faceOkSinceRef.current = null;
        faceBadSinceRef.current ||= now;
        if (now - faceBadSinceRef.current >= FACE_BAD_SUSTAIN_MS) {
          setFaceStatus(frameVerdict === "no_face" || frameVerdict === "multiple_faces" ? frameVerdict : "looking_away");
          if (frameVerdict !== "no_face" && frameVerdict !== "multiple_faces" && canLog("suspicious_movement")) {
            logProctoringEvent("suspicious_movement", "medium", `${frameVerdict} — sustained ${(FACE_BAD_SUSTAIN_MS / 1000).toFixed(0)}s`);
          }
        }
        // Sustained no-face/multi-face events already logged above via their
        // own condition timers; nothing more to do here.
      }
    } catch (err) {
      console.warn("Face detection frame error:", err.message);
    }
  };

  const startLiveFaceDetection = async () => {
    try {
      await ensureModelsLoaded();
      setFaceStatus("ok");
      faceDetectionIntervalRef.current = setInterval(analyzeFaceDetection, 2000);
    } catch (err) {
      console.error("Failed to start live face detection:", err);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────

  const flushProctoringEvents = async () => {
    if (!proctoringSessionRef.current || eventQueueRef.current.length === 0) return null;
    // Never run two flushes concurrently — a second call just chains after.
    if (flushInFlightRef.current) {
      if (!eventFlushTimerRef.current) {
        eventFlushTimerRef.current = setTimeout(async () => {
          eventFlushTimerRef.current = null;
          await flushProctoringEvents();
        }, 1500);
      }
      return null;
    }
    flushInFlightRef.current = true;
    const events = eventQueueRef.current.splice(0, 20);
    try {
      const token = await getAuthToken();
      const response = await examService.logProctoringEventBatch(token, proctoringSessionRef.current._id, events);
      if (response.session?.trustScore !== undefined) setTrustScore(response.session.trustScore);
      return response.session?.trustScore ?? null;
    } catch (error) {
      // Preserve events for a later retry; do not spin in a tight retry loop.
      eventQueueRef.current.unshift(...events);
      console.error("Error batching proctoring events:", error);
      return null;
    } finally {
      flushInFlightRef.current = false;
    }
  };

  const logProctoringEventImpl = async (eventType, severity, details) => {
    if (!proctoringSessionRef.current) return null;

    // Optimistic update: deduct immediately so the score updates without
    // waiting for the network round-trip.
    const penalty = { low: 2, medium: 5, high: 10 }[severity] || 5;
    setTrustScore((prev) => Math.max(0, prev - penalty));

    // Every event goes through one batch pipeline — even high-severity ones.
    // They flush instantly, but a burst of simultaneous violations collapses
    // into a single request instead of firing one POST each.
    eventQueueRef.current.push({ type: eventType, severity, details, clientTimestamp: new Date().toISOString() });
    if (severity === "high" || eventQueueRef.current.length >= 5) {
      return flushProctoringEvents();
    }
    if (!eventFlushTimerRef.current) {
      eventFlushTimerRef.current = setTimeout(async () => {
        eventFlushTimerRef.current = null;
        await flushProctoringEvents();
      }, 7500);
    }
    return null;
  };

  // Stable identity for the monitoring callbacks below: they capture this
  // wrapper once, while the impl (and its closure over fresh state) stays
  // reachable through the "latest ref" pattern.
  const logProctoringEventRef = useRef(logProctoringEventImpl);
  logProctoringEventRef.current = logProctoringEventImpl;
  const logProctoringEvent = useCallback(
    (eventType, severity, details) =>
      logProctoringEventRef.current(eventType, severity, details),
    []
  );

  const handleCalibrationComplete = async (calibrationData) => {
    console.log("Calibration completed:", calibrationData);
    setCalibrationRequired(false);
    setCalibrationComplete(true);

    // Enable proctoring monitoring NOW. The fullscreen grace window also
    // starts here: camera prompts / webgazer init can still drop fullscreen
    // in the next few seconds — repaired silently, not flagged as cheating.
    monitoringEnabledRef.current = true;
    monitoringStartedAtRef.current = Date.now();

    // Start webcam after calibration
    await startWebcam();

    // Start live AI face detection
    startLiveFaceDetection();

    // Start WebGazer-based gaze tracking (sustainment-threshold model)
    startGazeTracking();

    // The calibration finish click is a fresh user gesture — the most
    // reliable moment to (re)enter fullscreen, since the request made at
    // "Start Exam" often expired during network round-trips or was dropped
    // by the camera-permission prompt.
    if (fullscreenRequiredRef.current) {
      await requestFullscreen();
      scheduleFullscreenRestore();
    }
  };

  const startGazeTracking = () => {
    if (gazeTrackerRef.current) return; // already running
    const tracker = new GazeTracker({
      onViolation: (details) => {
        logProctoringEvent("gaze_deviation", "high", details);
        showFocusWarning(
          "Warning: Your gaze left the screen for more than 5 seconds. This has been flagged as a violation."
        );
      },
    });
    gazeTrackerRef.current = tracker;
    tracker.start();
  };

  const handleCalibrationFailed = async (error) => {
    console.error("Calibration failed:", error);
    // Proceed with the exam (flagged) instead of dead-ending on the
    // "Initializing proctoring session…" screen: mark calibration done,
    // start the webcam and monitoring so proctoring still records events.
    setCalibrationRequired(false);
    setCalibrationComplete(true);
    monitoringEnabledRef.current = true;
    monitoringStartedAtRef.current = Date.now();
    await startWebcam();
    startLiveFaceDetection();
    startGazeTracking();
    logProctoringEvent(
      "calibration_failed",
      "high",
      `Camera calibration failed: ${error}`
    );
    showFocusWarning(
      "Camera calibration failed — continuing with a flagged proctoring session."
    );
    if (fullscreenRequiredRef.current) {
      await requestFullscreen();
      scheduleFullscreenRestore();
    }
  };

  const performAutoSave = async () => {
    if (!submission || submittingRef.current || autoSaveInFlightRef.current || dirtyAnswersRef.current.size === 0) return;

    try {
      autoSaveInFlightRef.current = true;
      setAutoSaveStatus("Saving...");
      const token = await getAuthToken();
      const changes = [...dirtyAnswersRef.current].map(([questionId, answer]) => ({ questionId, answer }));

      const response = await examService.autoSave(
        token,
        submission._id,
        changes,
      );

      setLastAutoSave(new Date(response.lastAutoSave));
      response.savedQuestionIds?.forEach((questionId) => {
        if (dirtyAnswersRef.current.get(questionId) === changes.find((change) => change.questionId === questionId)?.answer) dirtyAnswersRef.current.delete(questionId);
      });
      setAutoSaveStatus("Saved");
      consecutiveSaveFailuresRef.current = 0;

      setTimeout(() => setAutoSaveStatus(""), 2000);
    } catch (error) {
      console.error("Error auto-saving:", error);
      setAutoSaveStatus("Save failed");
      // Exponential backoff on failures — never a tight retry loop.
      const delays = [5000, 15000, 30000];
      const attempt = Math.min(consecutiveSaveFailuresRef.current, delays.length - 1);
      consecutiveSaveFailuresRef.current += 1;
      if (!autoSaveRetryRef.current) {
        autoSaveRetryRef.current = setTimeout(() => {
          autoSaveRetryRef.current = null;
          performAutoSave();
        }, delays[attempt]);
      }
    } finally {
      autoSaveInFlightRef.current = false;
    }
  };

  const requestFullscreen = async () => {
    try {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        await elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) {
        await elem.msRequestFullscreen();
      }
      setIsFullscreen(true);
    } catch (error) {
      console.error("Error requesting fullscreen:", error);
    }
  };

  const exitFullscreen = () => {
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => { });
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    } catch {
      // Ignore errors
    }
  };

  const handleFullscreenChange = useCallback(() => {
    const isCurrentlyFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );

    setIsFullscreen(isCurrentlyFullscreen);

    // Only log fullscreen exit if monitoring is enabled (not during calibration),
    // the exam actually requires fullscreen, the page is not hidden, exam is
    // active, not already submitting, and no in-app dialog is open
    // (Esc-to-dismiss also exits fullscreen).
    if (!isCurrentlyFullscreen && fullscreenRequiredRef.current && examRef.current && !submittingRef.current && !document.hidden && monitoringEnabledRef.current && !dialogActiveRef.current) {
      // Grace window right after monitoring starts: camera-permission prompts
      // and WebGazer's own getUserMedia can drop fullscreen seconds after the
      // student finishes calibration. That is a platform artifact, not a
      // cheating signal — repair silently instead of flagging it.
      const withinGrace = Date.now() - monitoringStartedAtRef.current < FULLSCREEN_SETTLE_GRACE_MS;
      if (withinGrace) {
        scheduleFullscreenRestore();
        return;
      }
      setFullscreenExitCount((prev) => {
        const newCount = prev + 1;
        logProctoringEvent(
          "fullscreen_exit",
          "high",
          `Exited fullscreen (count: ${newCount})`,
        );
        showFocusWarning(`Warning: You exited fullscreen mode (${newCount}). This event has been recorded for review.`);
        return newCount;
      });
      // Re-enter fullscreen automatically — but never while a submission is
      // in flight or a dialog is open (the intentional exit at the end of
      // submission happens then).
      setTimeout(() => {
        if (!submittingRef.current && !dialogActiveRef.current) requestFullscreen();
      }, 500);
    }
  }, [logProctoringEvent, showFocusWarning, scheduleFullscreenRestore]);

  // EventMonitor: handleVisibilityChange
  const handleVisibilityChange = useCallback(async () => {
    if (!examRef.current || submittingRef.current || !monitoringEnabledRef.current) return;

    if (document.hidden) {
      // Dedupe: the blur handler may have already recorded this same
      // violation moments earlier (e.g. minimize fires blur then hidden).
      const now = Date.now();
      if (now - lastTabViolationAtRef.current < 1200) return;
      lastTabViolationAtRef.current = now;

      focusLostAtRef.current = now;
      tabSwitchCountRef.current += 1;
      setTabSwitchCount(tabSwitchCountRef.current);
      const newScore = await logProctoringEvent(
        "tab_switch",
        "high",
        `Tab switched / minimized (count: ${tabSwitchCountRef.current})`,
      );
      const scoreInfo = newScore !== null ? ` Trust score: ${newScore}%` : "";
      showFocusWarning(
        `Warning: Tab switch detected (${tabSwitchCountRef.current}).${scoreInfo} This event has been recorded for review.`,
      );
    } else {
      // User returned to the exam tab
      if (focusLostAtRef.current) {
        const durationSec = Math.round((Date.now() - focusLostAtRef.current) / 1000);
        focusLostAtRef.current = null;
        logProctoringEvent(
          "tab_returned",
          "low",
          `Returned to exam after ${durationSec}s away`,
        );
      }
    }
  }, [showFocusWarning, logProctoringEvent]);

  const handleBlur = useCallback(async () => {
    if (!examRef.current || submittingRef.current || !monitoringEnabledRef.current) return;
    // If the page itself was hidden, visibilitychange owns this violation.
    if (document.hidden) return;

    // Alt+Tab / app switch keeps the page visible, so only "blur" fires.
    // Count it as a tab switch (high severity) instead of silent focus loss.
    const now = Date.now();
    if (now - lastTabViolationAtRef.current < 1200) return;
    lastTabViolationAtRef.current = now;

    focusLostAtRef.current = now;
    tabSwitchCountRef.current += 1;
    setTabSwitchCount(tabSwitchCountRef.current);
    const newScore = await logProctoringEvent(
      "tab_switch",
      "high",
      `Window switched (Alt+Tab or another app) — count: ${tabSwitchCountRef.current}`,
    );
    const scoreInfo = newScore !== null ? ` Trust score: ${newScore}%` : "";
    showFocusWarning(
      `Warning: You left the exam window (${tabSwitchCountRef.current}).${scoreInfo} This event has been recorded for review.`,
    );
  }, [showFocusWarning, logProctoringEvent]);

  const handleFocus = useCallback(() => {
    if (examRef.current && !submittingRef.current && focusLostAtRef.current) {
      const durationSec = Math.round((Date.now() - focusLostAtRef.current) / 1000);
      focusLostAtRef.current = null;
      lastTabViolationAtRef.current = Date.now();
      logProctoringEvent(
        "focus_returned",
        "low",
        `Returned to exam window after ${durationSec}s away`,
      );
    }
  }, [logProctoringEvent]);

  const handleCopyPaste = useCallback((e) => {
    if (examRef.current) {
      e.preventDefault();
      logProctoringEvent("copy_paste", "high", `${e.type} attempt detected`);
    }
  }, [logProctoringEvent]);

  const handleContextMenu = useCallback((e) => {
    if (examRef.current) {
      e.preventDefault();
      logProctoringEvent("right_click", "medium", "Right-click attempt");
    }
  }, [logProctoringEvent]);

  const blockRestrictedInputs = useCallback((e) => {
    if (!examRef.current) return;

    // Block PrintScreen (screenshot_attempt)
    if (e.key === "PrintScreen") {
      e.preventDefault();
      try { navigator.clipboard.writeText(""); } catch { /* Clipboard access is optional. */ }
      logProctoringEvent(
        "screenshot_attempt",
        "high",
        "Attempted to take a screenshot",
      );
      showFocusWarning("Warning: Taking screenshots is strictly prohibited (-10 trust score).");
      return;
    }

    // Block keyboard shortcuts: Ctrl/Cmd + C, V, P, A
    if (
      (e.ctrlKey || e.metaKey) &&
      ["c", "v", "p", "a"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      const shortcut = `Ctrl+${e.key.toUpperCase()}`;
      logProctoringEvent(
        "keyboard_shortcut",
        "medium",
        `Blocked shortcut: ${shortcut}`,
      );
      showFocusWarning(`Warning: Keyboard shortcut ${shortcut} is disabled (-5 trust score).`);
      return;
    }

    // Block Developer Tools: F12 or Ctrl+Shift+I
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) {
      e.preventDefault();
      logProctoringEvent(
        "dev_tools_opened",
        "high",
        "Attempted to open developer tools",
      );
      showFocusWarning("Warning: Opening developer tools is strictly prohibited (-10 trust score).");
      return;
    }
  }, [showFocusWarning, logProctoringEvent]);

  const setupMonitoring = () => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", handleCopyPaste);
    document.addEventListener("paste", handleCopyPaste);
    document.addEventListener("cut", handleCopyPaste);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", blockRestrictedInputs);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
  };

  const removeMonitoring = () => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    document.removeEventListener(
      "webkitfullscreenchange",
      handleFullscreenChange,
    );
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("copy", handleCopyPaste);
    document.removeEventListener("paste", handleCopyPaste);
    document.removeEventListener("cut", handleCopyPaste);
    document.removeEventListener("contextmenu", handleContextMenu);
    document.removeEventListener("keydown", blockRestrictedInputs);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("focus", handleFocus);
  };

  const cleanup = () => {
    removeMonitoring();
    exitFullscreen();
    clearRestoreTimers();

    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
    }
    if (autoSaveRetryRef.current) clearTimeout(autoSaveRetryRef.current);
    if (eventFlushTimerRef.current) clearTimeout(eventFlushTimerRef.current);
    if (faceDetectionIntervalRef.current) {
      clearInterval(faceDetectionIntervalRef.current);
      faceDetectionIntervalRef.current = null;
    }

    // Force stop all video elements and streams on the page FIRST before ending webgazer.
    try {
      if (window.localstream) {
        window.localstream.getTracks().forEach((track) => track.stop());
      }
      if (window.webgazer && window.webgazer.stream) {
        window.webgazer.stream.getTracks().forEach((track) => track.stop());
      }
      document.querySelectorAll("video").forEach((vid) => {
        if (vid.srcObject && typeof vid.srcObject.getTracks === 'function') {
          vid.srcObject.getTracks().forEach((track) => track.stop());
          vid.srcObject = null;
        }
      });
    } catch(err) {
      console.warn("Error sweeping video tags", err);
    }

    try {
      if (gazeTrackerRef.current) {
        gazeTrackerRef.current.stop();
        gazeTrackerRef.current = null;
      }
    } catch { /* WebGazer may already be stopped. */ }

    if (focusWarningTimerRef.current) {
      clearTimeout(focusWarningTimerRef.current);
    }

    try {
      // Stop via the dedicated stream ref first (reliable even after navigation).
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      // Also clear the video element's srcObject so the browser releases the device.
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    } catch { /* Media stream may already be released. */ }

    if (window.webgazer) {
      try {
        window.webgazer.end();
      } catch { /* WebGazer may already be stopped. */ }
    }
  };

  const handleAnswerChange = useCallback((questionId, value) => {
    answersRef.current[questionId] = value;
    dirtyAnswersRef.current.set(questionId, value);
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  }, []);

  const goToQuestion = useCallback((index) => {
    setCurrentQuestion((prevCurrent) => {
      const activeExam = examRef.current;
      if (
        activeExam?.settings?.allowBackNavigation !== false ||
        index >= prevCurrent
      ) {
        return index;
      }
      return prevCurrent;
    });
  }, []);

  const getWordCountForValidate = (text) => {
    return text ? text.trim().split(/\s+/).filter(word => word.length > 0).length : 0;
  };

  const validateWordLimits = () => {
    for (let i = 0; i < exam.questions.length; i++) {
      const q = exam.questions[i];
      // Only validate word limits for short_answer and essay questions
      if ((q.type === "short_answer" || q.type === "essay") && q.constraints?.wordLimit) {
        const answer = answers[q._id] || "";
        const wordCount = getWordCountForValidate(answer);
        if (wordCount > q.constraints.wordLimit) {
          return {
            valid: false,
            message: `Question ${i + 1} exceeds word limit of ${q.constraints.wordLimit} words (current: ${wordCount} words)`,
          };
        }
      }
    }
    return { valid: true };
  };

  const handleSubmit = async (autoSubmit = false) => {
    if (submittingRef.current || submittedRef.current) return;

    // Validate word limits
    if (!autoSubmit) {
      const wordLimitValidation = validateWordLimits();
      if (!wordLimitValidation.valid) {
        await showNotice({
          title: "Check your answers",
          message: wordLimitValidation.message,
          tone: "danger",
        });
        return;
      }
    }

    // Minimum-time floor — the server enforces this too, but failing there
    // would lock the student out with a confusing error, so mirror it here.
    if (!autoSubmit && submitUnlockAt && Date.now() < submitUnlockAt) {
      const remaining = Math.ceil((submitUnlockAt - Date.now()) / 60000);
      await showNotice({
        title: "Too early to submit",
        message: `You need to spend at least ${Math.ceil((submitUnlockAt - new Date(submission?.startedAt || Date.now()).getTime()) / 60000)} minutes on this exam before submitting. About ${remaining} minute${remaining === 1 ? "" : "s"} left.`,
        tone: "info",
      });
      return;
    }

    // In-app confirmation — no window.confirm. Native popups drop the browser
    // out of fullscreen and would log a false fullscreen-exit violation even
    // when the student cancels. Nothing here leaves the page, so cancelling
    // is completely consequence-free.
    if (!autoSubmit) {
      const unansweredCount = Object.values(answers).filter(
        (a) => !a || String(a).trim() === "",
      ).length;
      const confirmed = await showConfirm({
        title: unansweredCount > 0 ? "Submit with unanswered questions?" : "Submit your exam?",
        message:
          unansweredCount > 0
            ? `You have ${unansweredCount} unanswered question(s). Once submitted you cannot change your answers.`
            : "Once submitted you cannot change your answers.",
        confirmLabel: "Yes, Submit Exam",
      });
      if (!confirmed) return; // Cancelled — nothing flagged, fullscreen untouched
    }

    try {
      setSubmitting(true);
      submittingRef.current = true;

      // Fullscreen and the webcam stay ON for the entire submission — they are
      // only released in cleanup() below, after the exam has been submitted.
      const token = await getAuthToken();

      // Flush any queued violations and close the proctoring session together,
      // so nothing recorded during the exam is lost or delayed. Uses the ref —
      // the timer-driven auto-submit path must never see a stale closure.
      await Promise.allSettled([
        proctoringSessionRef.current
          ? examService.endProctoringSession(token, proctoringSessionRef.current._id)
          : Promise.resolve(),
        flushProctoringEvents(),
      ]);

      const submissionData = {
        examId,
        submissionId: submission?._id,
        answers: Object.entries(answers).map(([questionId, answer]) => ({
          questionId,
          answer: answer || "",
        })),
        tabSwitchCount,
        fullscreenExitCount,
      };

      // Auto-submit at time-up must not die on a single network hiccup:
      // retry with backoff while the page is still alive. If every attempt
      // fails, the server-side sweeper finalizes from auto-saves anyway.
      let result = null;
      let lastSubmitError = null;
      const retryDelays = [3000, 6000, 12000];
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        try {
          result = await examService.submitExam(token, submissionData);
          break;
        } catch (err) {
          lastSubmitError = err;
          if (!autoSubmit || attempt === retryDelays.length) break;
          console.warn(
            `Auto-submit attempt ${attempt + 1} failed — retrying in ${retryDelays[attempt] / 1000}s`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
        }
      }
      if (!result) throw lastSubmitError;

      const pendingReview =
        result.gradingStatus === "pending_review" ||
        result.submission?.status === "partially_graded";

      // Submission accepted. Release `submitting` BEFORE showing the outcome
      // dialog — the dialog's action buttons ("Go to Dashboard") render with
      // disabled={submitting}, so leaving it true left the button dead.
      // submittedRef keeps any stray time-up auto-submit a no-op meanwhile.
      submittedRef.current = true;
      setSubmitting(false);

      // Show the outcome while still in fullscreen; release camera + fullscreen
      // only after the student acknowledges it.
      await showNotice({
        title: "Exam submitted",
        message: result.resultsPending
          ? "Submitted successfully! Results are withheld until the exam window closes for everyone — check My Submissions afterwards."
          : pendingReview
            ? "Submitted successfully! Your objective answers have been auto-scored. Written answers are now pending coordinator review — your final score will appear on the dashboard once reviewed."
            : `Submitted successfully!\nScore: ${result.score}/${result.maxScore} (${result.percentage}%)`,
        confirmLabel: "Go to Dashboard",
        tone: "success",
      });

      // Acknowledged — NOW stop the camera and leave fullscreen.
      cleanup();
      navigate("/dashboard", { replace: true });
    } catch (error) {
      console.error("Error submitting exam:", error);
      await showNotice({
        title: autoSubmit ? "Auto-submission failed" : "Submission failed",
        message: autoSubmit
          ? "Your exam could not be submitted due to a connection problem. Your answers remain auto-saved — the server will close and grade your attempt automatically when the exam window ends."
          : "Your exam could not be submitted: " +
            (error.response?.data?.message || error.message) +
            ". You are still in the exam — please try again. Your answers remain auto-saved.",
        tone: "danger",
      });
      // Submission failed: hand control back to the student untouched —
      // camera, monitoring and fullscreen all continue as before.
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  // Latest handleSubmit for the timer's time-up path (no stale closure).
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  if (loading) {
    return <LoadingScreen message="Loading exam…" />;
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-danger">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-[20px] font-bold text-ink">Something went wrong</h1>
          <p className="mt-2 break-words text-sm text-danger">{loadError}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            If you were already in this exam, your answers are safe — auto-save
            has kept them up to date. Please return to the dashboard and try again.
          </p>
          <Button variant="secondary" size="lg" className="mt-6 w-full" onClick={() => navigate("/dashboard", { replace: true })}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (showInstructions && exam) {
    return (
      <div className="min-h-screen bg-canvas px-4 py-8">
        <div className="mx-auto max-w-2xl rounded-lg border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-6 py-5 sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-dark">Mock Test</p>
            <h1 className="mt-1 text-[24px] font-bold tracking-tight text-ink">{exam.title}</h1>
          </div>

          <div className="space-y-6 px-6 py-6 sm:px-8">
            <section>
              <h2 className="text-[16px] font-semibold text-ink">Exam Instructions</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">
                {exam.instructions ||
                  "Please read the following instructions carefully before starting the exam."}
              </p>
            </section>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {[
                ["Duration", `${exam.duration} min`],
                ["Total Questions", exam.questionCount || exam.questions?.length || 0],
                [
                  "Total Points",
                  exam.questions ? exam.questions.reduce((sum, q) => sum + q.points, 0) : "N/A",
                ],
                ...(exam.settings?.passingScore
                  ? [["Passing Score", `${exam.settings.passingScore}%`]]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>

            <section className="rounded-md bg-primary-light p-4 sm:p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                Proctoring Notice
              </h3>
              <ul className="mt-2.5 space-y-1.5 text-[13px] leading-relaxed text-stone-600">
                {exam.settings?.requireWebcam !== false && (
                  <>
                    <li>Your webcam will be enabled during the exam</li>
                    <li>Eye gaze tracking is active — looking away for more than 5 seconds will be flagged</li>
                  </>
                )}
                <li>Tab switching and window focus will be monitored</li>
                {exam.settings?.requireFullscreen !== false ? (
                  <li>Fullscreen mode is required</li>
                ) : (
                  <li>Keep this tab visible at all times</li>
                )}
                <li>Copy/paste and right-click are disabled</li>
                <li>Your answers are auto-saved every 30 seconds</li>
                {(exam.settings?.minDurationMinutes || 0) > 0 && (
                  <li className="font-medium text-ink">
                    You can submit only after spending at least{" "}
                    {exam.settings.minDurationMinutes} minutes on this exam
                  </li>
                )}
              </ul>
            </section>

            <Button
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => {
                // Enter fullscreen synchronously inside the click handler:
                // browsers only honour the request while the transient user
                // activation is fresh, and startExamSession awaits two API
                // calls before its own attempt — on slow campus Wi-Fi that
                // activation has already expired, leaving students windowed.
                if ((exam.settings?.requireFullscreen ?? true) !== false) {
                  requestFullscreen();
                }
                setShowInstructions(false);
              }}
            >
              I Understand, Start Exam
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!exam) {
    return (
      <LoadingScreen message="Exam not found" />
    );
  }

  if (calibrationRequired && proctoringSession) {
    return (
      <Suspense fallback={<LoadingScreen message="Preparing camera check…" />}>
        <CalibrationScreen
          onCalibrationComplete={handleCalibrationComplete}
          onCalibrationFailed={handleCalibrationFailed}
          token={getAuthToken}
          sessionId={proctoringSession._id}
        />
      </Suspense>
    );
  }

  if (!calibrationComplete && exam.settings?.requireWebcam !== false && !showInstructions) {
    return <LoadingScreen message="Initializing proctoring session…" />;
  }

  // Show locked overlay
  if (isLocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-danger">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-[20px] font-bold text-ink">Exam Locked</h1>
          <p className="mt-2 text-sm text-danger">{lockReason}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Your answers have been automatically submitted. Your coordinator has
            been notified and will review your submission.
          </p>
          <dl className="mt-6 grid grid-cols-3 divide-x divide-line rounded-md border border-line py-3">
            {[
              ["Tab Switches", tabSwitchCount],
              ["Fullscreen Exits", fullscreenExitCount],
              ["Trust Score", `${trustScore}%`],
            ].map(([label, value], i) => (
              <div key={label}>
                <dd className={`text-lg font-bold tabular-nums ${i === 2 && trustScore < 50 ? "text-danger" : "text-ink"}`}>
                  {value}
                </dd>
                <dt className="mt-0.5 text-xs text-ink-muted">{label}</dt>
              </div>
            ))}
          </dl>
          <Button variant="secondary" size="lg" className="mt-6 w-full" onClick={() => navigate("/dashboard", { replace: true })}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (!exam.questions || !Array.isArray(exam.questions) || exam.questions.length === 0) {
    return <LoadingScreen message="Preparing your exam…" />;
  }

  const currentQ = exam.questions[currentQuestion];
  const gateActive = !!submitUnlockAt && Date.now() < submitUnlockAt;
  const gateSecondsLeft = gateActive
    ? Math.ceil((submitUnlockAt - Date.now()) / 1000)
    : 0;
  const gateClock = `${String(Math.floor(gateSecondsLeft / 60)).padStart(2, "0")}:${String(gateSecondsLeft % 60).padStart(2, "0")}`;

  if (!currentQ) {
    return <LoadingScreen message="Question not found" />;
  }

  const answeredCount = Object.values(answers).filter((a) => a && String(a).trim() !== "").length;
  const allowBackNav = exam.settings?.allowBackNavigation !== false;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* ── Header bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <h1 className="truncate text-[15px] font-semibold text-ink">{exam.title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <span aria-live="polite" className="hidden text-xs text-ink-muted sm:inline">
              {autoSaveStatus || (lastAutoSave ? `Saved ${lastAutoSave.toLocaleTimeString()}` : "")}
            </span>
            <ExamTimer endAt={examEndAt} onTimeUp={handleTimeUp} onMilestone={handleTimeMilestone} />
            <div
              title="Trust score"
              className={`hidden items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-sm font-medium sm:flex ${
                trustScore < 50 ? "border-danger bg-red-50 text-danger" : "border-line bg-surface text-ink"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span className="tabular-nums">{trustScore}%</span>
            </div>
            {/* Always-visible submit: reachable from ANY question — students
                should not have to navigate to the last question to finish.
                Mirrors the min-duration gate and submitting/time-up states. */}
            <Button
              size="sm"
              className="shrink-0 tabular-nums"
              onClick={() => handleSubmit(false)}
              disabled={submitting || timeUp || gateActive}
              title={gateActive ? `Submitting unlocks in ${gateClock}` : undefined}
            >
              {gateActive
                ? `Locked ${gateClock}`
                : submitting || timeUp
                  ? "Submitting…"
                  : "Submit Exam"}
            </Button>
          </div>
        </div>
      </header>

      {/* ── Floating webcam monitor (top-right corner, click-transparent) ──
          Rendered only when the exam requires a camera. It mounts before
          startWebcam() runs, so videoRef always exists when the stream starts. */}
      {exam.settings?.requireWebcam !== false && (
        <div className="pointer-events-none fixed right-3 top-16 z-40 flex flex-col items-end gap-1.5">
          <div className="overflow-hidden rounded-md border border-line bg-black shadow-lg ring-1 ring-black/10">
            <video ref={videoRef} autoPlay muted playsInline style={VIDEO_STYLE} />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex items-center gap-1.5">
            {webcamEnabled && faceStatus === "ok" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Face OK
              </span>
            )}
            {webcamEnabled && faceStatus === "no_face" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" /> No Face
              </span>
            )}
            {webcamEnabled && faceStatus === "multiple_faces" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" /> Multiple Faces
              </span>
            )}
            {webcamEnabled && faceStatus === "looking_away" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" /> Look at screen
              </span>
            )}
            {!webcamEnabled && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                No webcam
              </span>
            )}
          </div>
        </div>
      )}

      {focusWarning && (
        <div
          role="alert"
          className="sticky top-14 z-20 flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:px-6"
        >
          <p className="mx-auto max-w-5xl flex-1 text-[13px] font-medium text-amber-900">
            {focusWarning}
          </p>
          <button
            type="button"
            onClick={() => setFocusWarning(null)}
            aria-label="Dismiss warning"
            className="shrink-0 rounded-sm p-0.5 text-amber-700 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {!isFullscreen && (
        <div className="border-b border-line bg-primary-light">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 text-[13px] text-stone-600 sm:px-6">
            <span>
              Tab switches: <strong className="tabular-nums">{tabSwitchCount}</strong>
              {" · "}Fullscreen exits: <strong className="tabular-nums">{fullscreenExitCount}</strong>
            </span>
            <button
              type="button"
              onClick={requestFullscreen}
              className="rounded-sm px-2.5 py-1 font-medium text-accent-dark underline-offset-2 transition-colors hover:bg-amber-100 hover:text-accent-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Return to fullscreen
            </button>
          </div>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-6 lg:py-6">
        <div className="lg:flex lg:items-start lg:gap-6">

          {/* Palette (above question on mobile, sidebar on desktop) */}
          <aside className="mb-4 w-full lg:sticky lg:top-16 lg:order-2 lg:mb-0 lg:w-56 lg:shrink-0">
            <details open className="group rounded-md border border-line bg-surface shadow-sm lg:open">
              <summary className="flex cursor-pointer list-none select-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                Questions
                <span className="text-xs font-normal text-ink-muted">
                  {answeredCount}/{exam.questions.length} answered
                </span>
              </summary>
              <div className="border-t border-line px-4 pb-4 pt-3 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto">
                {sectionGroups.length === 0 ? (
                  <PaletteGrid
                    questions={exam.questions}
                    answers={answers}
                    currentQuestion={currentQuestion}
                    allowBackNav={allowBackNav}
                    onSelect={goToQuestion}
                  />
                ) : (
                  <div className="space-y-2.5">
                    {sectionGroups.map((group) => {
                      const isOpen = openSections.has(group.key);
                      const answeredInSection = group.indices.reduce(
                        (count, qIndex) => {
                          const a = answers[exam.questions[qIndex]._id];
                          return count + (a && String(a).trim() !== "" ? 1 : 0);
                        },
                        0,
                      );
                      return (
                        <div key={group.key}>
                          <button
                            type="button"
                            onClick={() => toggleSectionOpen(group.key)}
                            aria-expanded={isOpen}
                            className="flex w-full items-center justify-between gap-2 rounded-sm px-1 py-1 text-left text-[13px] font-semibold text-ink transition-colors duration-150 hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                                className={`shrink-0 text-ink-muted transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                              <span className="truncate">{group.name}</span>
                            </span>
                            <span className="shrink-0 text-[11px] font-normal tabular-nums text-ink-muted">
                              {answeredInSection}/{group.indices.length}
                            </span>
                          </button>
                          {isOpen && (
                            <div className="mt-1.5">
                              <PaletteGrid
                                questions={exam.questions}
                                indices={group.indices}
                                answers={answers}
                                currentQuestion={currentQuestion}
                                allowBackNav={allowBackNav}
                                onSelect={goToQuestion}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs text-ink-muted">
                  <li className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-[3px] border border-primary bg-primary" /> Current
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-[3px] border border-green-300 bg-green-50" /> Answered
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-[3px] border border-line bg-surface" /> Not answered
                  </li>
                </ul>
              </div>
              {/* Pinned below the scrollable palette — submit from any question
                  without scrolling or jumping to the last one (desktop only;
                  on mobile the header button covers this). */}
              <div className="hidden border-t border-line px-4 py-3 lg:block">
                <Button
                  className="w-full tabular-nums"
                  onClick={() => handleSubmit(false)}
                  disabled={submitting || timeUp || gateActive}
                  title={gateActive ? `Submitting unlocks in ${gateClock}` : undefined}
                >
                  {gateActive
                    ? `Locked ${gateClock}`
                    : submitting || timeUp
                      ? "Submitting…"
                      : "Submit Exam"}
                </Button>
              </div>
            </details>
          </aside>

          {/* Question column */}
          <div className="min-w-0 flex-1 lg:order-1">
            <QuestionCard
              question={currentQ}
              index={currentQuestion}
              total={exam.questions.length}
              answer={answers[currentQ._id]}
              onAnswerChange={handleAnswerChange}
              sectionName={
                currentQ.sectionId
                  ? sectionNameById.get(String(currentQ.sectionId))
                  : undefined
              }
            />

            <div className="mt-4 flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                onClick={() => goToQuestion(Math.max(0, currentQuestion - 1))}
                disabled={currentQuestion === 0 || !allowBackNav}
              >
                Previous
              </Button>

              <span className="text-[13px] tabular-nums text-ink-muted">
                {answeredCount} of {exam.questions.length} answered
              </span>

              {currentQuestion < exam.questions.length - 1 ? (
                <Button onClick={() => goToQuestion(currentQuestion + 1)}>
                  Next
                </Button>
              ) : gateActive ? (
                <Button disabled title={`Submitting unlocks in ${gateClock}`}>
                  Locked {gateClock}
                </Button>
              ) : (
                <Button
                  onClick={() => handleSubmit(false)}
                  disabled={submitting || timeUp}
                >
                  {submitting ? "Submitting…" : "Submit Exam"}
                </Button>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Footer status strip ───────────────────────────── */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 text-xs text-ink-muted sm:px-6">
          <span>
            Answered: <strong className="tabular-nums text-ink">{answeredCount}</strong> / {exam.questions.length}
          </span>
          {gateActive && (
            <span className="font-medium text-amber-700" aria-live="polite">
              Submit unlocks in {gateClock}
            </span>
          )}
          <span aria-live="polite">{autoSaveStatus}</span>
          <span className="sm:hidden">
            Trust <strong className="tabular-nums text-ink">{trustScore}%</strong>
          </span>
        </div>
      </footer>

      {/* ── In-app dialog (replaces window.alert / window.confirm) ── */}
      <Modal
        open={!!dialog}
        onClose={() => settleDialog(false)}
        title={dialog?.title}
      >
        <div className="flex items-start gap-3.5">
          {dialog?.tone === "success" && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-50 text-success">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          )}
          {(dialog?.tone === "danger") && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-danger">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
          )}
          <p className="whitespace-pre-line pt-1.5 text-sm leading-relaxed text-ink">
            {dialog?.message}
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          {dialog?.kind === "confirm" && (
            <Button variant="secondary" onClick={() => settleDialog(false)}>
              Cancel
            </Button>
          )}
          <Button
            onClick={() => settleDialog(dialog?.kind === "confirm")}
            disabled={submitting}
          >
            {dialog?.confirmLabel || "OK"}
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default TakeExam;
