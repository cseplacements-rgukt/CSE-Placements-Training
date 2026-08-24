import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { examService } from "../services/examService";
import AppLayout from "../components/AppLayout";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";
import Skeleton, { SkeletonText } from "../components/ui/Skeleton";
import { Input } from "../components/ui/Input";

/* ── SVG icons ───────────────────────────────────────────────── */
const iconProps = {
  className: "h-4 w-4 shrink-0",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};
const CalendarIcon = () => (
  <svg {...iconProps}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
);
const ClockIcon = () => (
  <svg {...iconProps}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
);
const QuestionIcon = () => (
  <svg {...iconProps}><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>
);
const PercentIcon = () => (
  <svg {...iconProps}><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M18 6L6 18"/></svg>
);
const ShieldIcon = ({ className = "h-4 w-4 shrink-0" }) => (
  <svg {...iconProps} className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
);
const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const ClipboardLarge = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>
  </svg>
);

const STATUS_VARIANT = {
  draft: "neutral",
  review: "info",
  ended: "neutral",
  upcoming: "warning",
  active: "success",
};

const StatCardSkeleton = () => (
  <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
    <Skeleton className="h-8 w-14" />
    <Skeleton className="mt-2 h-3.5 w-24" />
  </div>
);

const ExamCardSkeleton = () => (
  <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
    <div className="mt-5 grid grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonText key={i} lines={2} />
      ))}
    </div>
    <div className="mt-5 flex justify-end gap-2">
      <Skeleton className="h-9 w-20" />
      <Skeleton className="h-9 w-20" />
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Dashboard
   ═══════════════════════════════════════════════════════════════ */
const Dashboard = () => {
  const { userProfile, getAuthToken } = useAuth();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const navigate = useNavigate();

  // Exam code state (student)
  const [examCode, setExamCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [joinedExam, setJoinedExam] = useState(null);

  // Copy feedback
  const [copiedId, setCopiedId] = useState(null);

  const isExamTeam = ["coordinator", "admin", "super_admin"].includes(userProfile?.role);

  useEffect(() => {
    if (!userProfile?._id) return;
    setLoading(true);
    if (isExamTeam) {
      fetchExams();
    } else {
      setLoading(false);
    }
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?._id, userProfile?.role]);

  const fetchExams = async () => {
    try {
      const token = await getAuthToken();
      const data = await examService.getExams(token);
      setExams(data.exams || []);
    } catch (err) {
      console.error("Error fetching exams:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    try {
      const token = await getAuthToken();
      const data = await examService.getNotifications(token);
      setNotifications(data.notifications?.filter((n) => !n.isRead).slice(0, 5) || []);
    } catch (err) {
      console.error("Error fetching notifications:", err);
    }
  };

  const markNotificationRead = async (notificationId) => {
    try {
      const token = await getAuthToken();
      await examService.markNotificationRead(token, notificationId);
      setNotifications(notifications.filter((n) => n._id !== notificationId));
    } catch (err) {
      console.error("Error marking notification read:", err);
    }
  };

  // ── Student: Join exam by code ─────────────────────────────
  const handleJoinExam = async (e) => {
    e.preventDefault();
    setCodeError("");
    setJoinedExam(null);
    const code = examCode.trim().toUpperCase();
    if (!code) { setCodeError("Please enter an exam code."); return; }
    try {
      setCodeLoading(true);
      const token = await getAuthToken();
      const data = await examService.joinExam(token, code);
      setJoinedExam(data.exam);
    } catch (err) {
      setCodeError(err.response?.data?.message || "Invalid exam code.");
    } finally {
      setCodeLoading(false);
    }
  };

  // ── Admin: Copy exam code ──────────────────────────────────
  const handleCopyCode = (code, examId) => {
    navigator.clipboard.writeText(code);
    setCopiedId(examId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getExamStatus = (exam) => {
    if (exam.status === "draft") return { status: "draft", label: "Draft", variant: STATUS_VARIANT.draft };
    if (exam.status === "ready_for_review") return { status: "review", label: "Ready for Review", variant: STATUS_VARIANT.review };
    if (exam.status === "closed") return { status: "ended", label: "Closed", variant: STATUS_VARIANT.ended };
    const now = new Date();
    const scheduledAt = new Date(exam.scheduledAt);
    const endTime = new Date(exam.endTime || scheduledAt.getTime() + exam.duration * 60000);
    if (now > endTime) return { status: "ended", label: "Ended", variant: STATUS_VARIANT.ended };
    if (now < scheduledAt) return { status: "upcoming", label: "Upcoming", variant: STATUS_VARIANT.upcoming };
    return { status: "active", label: "Live Now", variant: STATUS_VARIANT.active };
  };

  /* ── Derived ──────────────────────────────────────────────── */
  const displayExams = isExamTeam ? exams : [];
  const groupedExams = displayExams.reduce((acc, exam) => {
    const company = exam.targetCompany || "General Mock Tests";
    if (!acc[company]) acc[company] = [];
    acc[company].push(exam);
    return acc;
  }, {});

  const totalExams    = exams.length;
  const activeCount   = exams.filter((e) => getExamStatus(e).status === "active").length;
  const upcomingCount = exams.filter((e) => getExamStatus(e).status === "upcoming").length;

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  if (!userProfile) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
          </div>
          <ExamCardSkeleton />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* ── Page header ───────────────────────────── */}
        <PageHeader
          title={`${greeting()}, ${userProfile?.name?.split(" ")[0]}`}
          subtitle={
            userProfile?.role === "student"
              ? "Ready for your next mock test?"
              : "CSE Placements Training · Mock Test Management"
          }
          actions={
            <>
              {isExamTeam && (
                <Button onClick={() => navigate("/create-exam")}>+ Create Mock Test</Button>
              )}
              {userProfile?.role === "student" && (
                <Button variant="secondary" onClick={() => navigate("/my-submissions")}>
                  My Results
                </Button>
              )}
            </>
          }
        />

        {/* ── Notifications ─────────────────────────── */}
        {notifications.length > 0 && (
          <section aria-label="Notifications" className="space-y-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
              Notifications
            </h2>
            <div className="space-y-2">
              {notifications.map((n) => (
                <div
                  key={n._id}
                  className={`flex items-start gap-3 rounded-sm border-l-[3px] px-4 py-3 text-sm ${
                    n.priority === "high"
                      ? "border-danger bg-red-50 text-red-900"
                      : "border-accent bg-amber-50 text-amber-900"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{n.title}</p>
                    <p className="mt-0.5 opacity-80">{n.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => markNotificationRead(n._id)}
                    title="Dismiss"
                    aria-label={`Dismiss notification: ${n.title}`}
                    className="shrink-0 rounded-sm p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════════
            STUDENT VIEW — Exam Code Entry
            ═══════════════════════════════════════════════ */}
        {userProfile?.role === "student" && (
          <div className="mx-auto max-w-2xl">
            <div className="rounded-lg border border-line bg-surface p-6 shadow-sm sm:p-8">
              <h2 className="text-[18px] font-semibold text-ink">Enter Exam Code</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Enter the exam code provided by the placement cell to access your mock test.
              </p>

              <form onSubmit={handleJoinExam} className="mt-5">
                <label htmlFor="exam-code" className="mb-1.5 block text-sm font-medium text-ink">
                  Exam Code
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    id="exam-code"
                    type="text"
                    value={examCode}
                    onChange={(e) => { setExamCode(e.target.value.toUpperCase()); setCodeError(""); setJoinedExam(null); }}
                    placeholder="e.g. A7K9P2"
                    maxLength={10}
                    autoComplete="off"
                    spellCheck="false"
                    className="h-11 flex-1 rounded-sm border border-line bg-surface px-3 font-mono text-base uppercase tracking-[0.2em] text-ink transition-colors placeholder:font-sans placeholder:tracking-normal placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                  />
                  <Button type="submit" size="lg" disabled={codeLoading} className="sm:w-32">
                    {codeLoading ? "Checking…" : "Continue"}
                  </Button>
                </div>
                {codeError && (
                  <p role="alert" className="mt-2 flex items-center gap-1.5 text-[13px] text-danger">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {codeError}
                  </p>
                )}
              </form>

              {/* ── Joined exam info panel ──────────── */}
              {joinedExam && (
                <div className="mt-6 rounded-md border border-line bg-canvas p-5">
                  <h3 className="text-[16px] font-semibold text-ink">{joinedExam.title}</h3>
                  {joinedExam.description && (
                    <p className="mt-1 text-sm text-ink-muted">{joinedExam.description}</p>
                  )}

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    {[
                      ["Company", joinedExam.targetCompany],
                      ["Questions", joinedExam.questionCount],
                      ["Duration", `${joinedExam.duration} min`],
                      ["Category", joinedExam.examCategory],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
                        <dd className="mt-0.5 text-sm font-medium text-ink">{value ?? "—"}</dd>
                      </div>
                    ))}
                  </dl>

                  {joinedExam.settings?.requireWebcam && (
                    <div className="mt-4 flex items-center gap-2 rounded-sm bg-primary-light px-3 py-2.5 text-[13px] font-medium text-ink">
                      <ShieldIcon /> This is a proctored exam — webcam required
                    </div>
                  )}

                  {joinedExam.windowState === "upcoming" ? (
                    <Alert variant="warning" className="mt-4">
                      This exam hasn't started yet. It opens on{" "}
                      <strong>
                        {new Date(joinedExam.scheduledAt).toLocaleString("en-IN", {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
                        })}
                      </strong>{" "}
                      — come back then and enter this code again.
                    </Alert>
                  ) : (
                    <Button
                      size="lg"
                      className="mt-4 w-full"
                      onClick={() => navigate(`/take-exam/${joinedExam._id}`, { state: { examCode: examCode.trim().toUpperCase() } })}
                    >
                      {joinedExam.hasActiveAttempt ? "Resume Exam" : "Start Exam"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════
            ADMIN VIEW — Exam management
            ═══════════════════════════════════════════════ */}
        {isExamTeam && (
          <>
            {/* ── Stat cards ────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-3">
              {loading ? (
                <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
              ) : (
                <>
                  <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
                    <p className="text-[28px] font-bold leading-none tracking-tight text-ink">{totalExams}</p>
                    <p className="mt-1.5 text-sm text-ink-muted">Total Exams</p>
                  </div>
                  <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
                    <p className="text-[28px] font-bold leading-none tracking-tight text-success">{activeCount}</p>
                    <p className="mt-1.5 text-sm text-ink-muted">Live Now</p>
                  </div>
                  <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
                    <p className="text-[28px] font-bold leading-none tracking-tight text-warning">{upcomingCount}</p>
                    <p className="mt-1.5 text-sm text-ink-muted">Upcoming</p>
                  </div>
                </>
              )}
            </div>

            {/* ── Exams section ──────────────────────────── */}
            <section aria-label="Your mock tests" className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-[18px] font-semibold text-ink">Your Mock Tests</h2>
                {!loading && displayExams.length > 0 && (
                  <Badge variant="neutral">{displayExams.length} exam{displayExams.length !== 1 ? "s" : ""}</Badge>
                )}
              </div>

              {loading ? (
                <div className="space-y-4"><ExamCardSkeleton /><ExamCardSkeleton /></div>
              ) : displayExams.length === 0 ? (
                <div className="rounded-md border border-line bg-surface shadow-sm">
                  <EmptyState
                    icon={<ClipboardLarge />}
                    title="No exams yet"
                    description="Create your first mock test to get started."
                    action={<Button onClick={() => navigate("/create-exam")}>Create an Exam</Button>}
                  />
                </div>
              ) : (
                <div className="space-y-8">
                  {Object.keys(groupedExams).map((company) => (
                    <div key={company}>
                      <div className="mb-3 flex items-center gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary-light text-[13px] font-semibold text-ink">
                          {company.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-[15px] font-semibold text-ink">{company}</span>
                        <span className="h-px flex-1 bg-line" aria-hidden="true" />
                      </div>

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {groupedExams[company].map((exam) => {
                          const examStatus = getExamStatus(exam);
                          const winStart = new Date(exam.scheduledAt || Date.now());
                          const winEnd = exam.endTime ? new Date(exam.endTime) : new Date(winStart.getTime() + (exam.duration || 0) * 60000);
                          const windowTitle = `Window: ${winStart.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })} → ${winEnd.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
                          return (
                            <div key={exam._id} className="flex flex-col rounded-md border border-line bg-surface shadow-sm transition-shadow duration-150 hover:shadow-md">
                              <div className="p-5 pb-4">
                                <div className="flex items-start justify-between gap-3">
                                  <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug text-ink" title={exam.title}>
                                    {exam.title}
                                  </h3>
                                  <Badge dot variant={examStatus.variant}>{examStatus.label}</Badge>
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {exam.examCategory && (
                                    <Badge variant="neutral">{exam.examCategory}</Badge>
                                  )}
                                  {(exam.collaborators?.length || 0) > 1 && (
                                    <Badge variant="neutral" title={`${exam.collaborators.length} team members on this draft`}>
                                      {exam.collaborators.length} on team
                                    </Badge>
                                  )}
                                </div>

                                {/* Exam Code display for published exams */}
                                {exam.examCode && exam.status === "published" && (
                                  <div className="mt-3 flex items-center gap-2 rounded-sm bg-canvas px-3 py-2">
                                    <span className="text-xs text-ink-muted">Code:</span>
                                    <span className="font-mono text-sm font-semibold tracking-wider text-ink">{exam.examCode}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyCode(exam.examCode, exam._id)}
                                      title="Copy exam code"
                                      aria-label={`Copy exam code ${exam.examCode}`}
                                      className={`ml-auto flex h-7 w-7 items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                                        copiedId === exam._id
                                          ? "text-success"
                                          : "text-ink-muted hover:bg-primary-light hover:text-ink"
                                      }`}
                                    >
                                      {copiedId === exam._id ? (
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                      ) : (
                                        <CopyIcon />
                                      )}
                                    </button>
                                  </div>
                                )}

                                <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-4">
                                  {[
                                    { icon: <CalendarIcon />, value: exam.scheduledAt ? new Date(exam.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—", label: "Date", title: windowTitle },
                                    { icon: <ClockIcon />, value: exam.duration ? `${exam.duration} min` : "—", label: "Duration" },
                                    { icon: <QuestionIcon />, value: exam.questions?.length || 0, label: "Questions" },
                                    { icon: <PercentIcon />, value: exam.settings?.passingScore != null ? `${exam.settings.passingScore}%` : "—", label: "Passing" },
                                  ].map(({ icon, value, label, title }) => (
                                    <div key={label} title={title}>
                                      <dt className="flex items-center gap-1 text-stone-400">
                                        {icon}
                                        <span className="sr-only">{label}</span>
                                      </dt>
                                      <dd className="mt-0.5 truncate text-[13px] font-medium text-ink" title={String(value)}>{value}</dd>
                                      <dd className="text-[11px] text-ink-muted">{label}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>

                              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3.5">
                                {exam.settings?.requireWebcam ? (
                                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                                    <ShieldIcon className="h-3.5 w-3.5" /> Proctored
                                  </span>
                                ) : <span />}
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button size="sm" onClick={() => navigate(`/edit-exam/${exam._id}`)}>
                                    {["draft", "ready_for_review"].includes(exam.status) ? "Open Draft" : "Edit Details"}
                                  </Button>
                                  {["draft", "ready_for_review"].includes(exam.status) && (
                                    <Button size="sm" variant="secondary" onClick={() => navigate(`/edit-exam/${exam._id}?tab=review`)}>
                                      {exam.status === "ready_for_review" ? "Review & Publish" : "Publish"}
                                    </Button>
                                  )}
                                  {exam.status === "published" && (exam.totalSubmissions || 0) === 0 && (
                                    <Button size="sm" variant="secondary" onClick={async () => {
                                      if (window.confirm("Move this exam back to Draft? Students won't be able to join until you publish it again. The exam code will stay the same.")) {
                                        try {
                                          const token = await getAuthToken();
                                          await examService.unpublishExam(token, exam._id);
                                          fetchExams();
                                        } catch (e) { alert(e.response?.data?.message || "Failed to unpublish"); }
                                      }
                                    }}>Unpublish</Button>
                                  )}
                                  {exam.status === "published" && (
                                    <Button size="sm" variant="secondary" onClick={async () => {
                                      if (window.confirm("Are you sure you want to close this exam early?")) {
                                        try {
                                          const token = await getAuthToken();
                                          await examService.closeExam(token, exam._id);
                                          fetchExams();
                                        } catch { alert("Failed to close"); }
                                      }
                                    }}>Close</Button>
                                  )}
                                  <Button size="sm" variant="secondary" onClick={() => navigate(`/exam-submissions/${exam._id}`)}>Submissions</Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
