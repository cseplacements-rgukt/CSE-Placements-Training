import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { examService } from "../services/examService";
import AppLayout from "../components/AppLayout";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";
import Skeleton from "../components/ui/Skeleton";
import Modal from "../components/ui/Modal";
import Pagination from "../components/ui/Pagination";
import usePagedData from "../hooks/usePagedData";
import { buildSectionGroups, sectionNamesById } from "../lib/examSections";

const PAGE_SIZE = 12;

const STATUS_VARIANTS = {
  in_progress: { label: "In Progress", variant: "neutral" },
  submitted: { label: "Submitted", variant: "success" },
  grading: { label: "Submitted", variant: "success" },
  graded: { label: "Submitted", variant: "success" },
  partially_graded: { label: "Submitted", variant: "success" },
  locked: { label: "Locked", variant: "danger" },
};

const getStatusConfig = (status) =>
  STATUS_VARIANTS[status] || { label: status, variant: "neutral" };

const canShowCorrectAnswer = (submission) => {
  const settings = submission.examId?.settings;
  return settings?.showResultsImmediately !== false;
};

const getPerformance = (percentage, passingScore = 50) => {
  if (percentage >= 90) return { label: "Outstanding", color: "text-emerald-600", bg: "bg-emerald-50", bar: "bg-emerald-500" };
  if (percentage >= 75) return { label: "Excellent", color: "text-green-600", bg: "bg-green-50", bar: "bg-green-500" };
  if (percentage >= 60) return { label: "Good", color: "text-blue-600", bg: "bg-blue-50", bar: "bg-blue-500" };
  if (percentage >= passingScore) return { label: "Passed", color: "text-amber-600", bg: "bg-amber-50", bar: "bg-amber-500" };
  return { label: "Needs Improvement", color: "text-red-600", bg: "bg-red-50", bar: "bg-red-500" };
};

const percentileSuffix = (n) => {
  if (n == null || isNaN(n)) return "";
  const v = Number(n);
  if (v === 11 || v === 12 || v === 13) return "th";
  const last = v % 10;
  if (last === 1) return "st";
  if (last === 2) return "nd";
  if (last === 3) return "rd";
  return "th";
};

const CardSkeleton = () => (
  <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-5 w-20 rounded-full" />
    </div>
    <div className="mt-5 grid grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
    <Skeleton className="mt-5 h-9 w-24" />
  </div>
);

// ── Small circular percentage ring (SVG) ──
const CircleRing = ({ percentage, size = 56, label }) => {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, percentage)) / 100) * circ;
  const perf = getPerformance(percentage);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="#e7e5e4" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="currentColor"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className={perf.color}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums ${perf.color}`}>
          {Math.round(percentage)}%
        </span>
      </div>
      {label && <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</span>}
    </div>
  );
};

const ScoreHeroCard = ({ submission }) => {
  const score = submission.score ?? 0;
  const maxScore = submission.maxScore ?? 0;
  const percentage = submission.percentage ?? 0;
  const percentile = submission.percentile;
  const rank = submission.rank;
  const total = submission.totalParticipants;
  const passingScore = submission.examId?.settings?.passingScore ?? 50;
  const perf = getPerformance(percentage, passingScore);
  const hasPercentile = typeof percentile === "number" && !isNaN(percentile);

  return (
    <div className={`rounded-lg border p-3.5 ${perf.bg} border-line`}>
      {/* top metrics */}
      <div className="grid grid-cols-3 divide-x divide-line/60">
        <div className="px-2 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Score</p>
          <p className="mt-1 text-[18px] font-bold leading-none tabular-nums text-ink">
            {score}
            <span className="text-[13px] font-medium text-ink-muted">/{maxScore || "—"}</span>
          </p>
          <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${perf.bg} ${perf.color} border border-current/15`}>
            {perf.label}
          </p>
        </div>
        <div className="flex flex-col items-center justify-center px-2 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Percentage</p>
          <div className="mt-1 flex items-baseline gap-0.5">
            <span className={`text-[22px] font-bold leading-none tabular-nums ${perf.color}`}>{Math.round(percentage)}</span>
            <span className="text-sm font-semibold text-ink-muted">%</span>
          </div>
          <div className="mt-2 h-1.5 w-full max-w-[90px] overflow-hidden rounded-full bg-white/80">
            <div className={`h-full rounded-full ${perf.bar}`} style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} />
          </div>
        </div>
        <div className="px-2 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Percentile</p>
          {hasPercentile ? (
            <>
              <p className="mt-1 text-[18px] font-bold leading-none tabular-nums text-ink">
                {percentile}
                <span className="align-super text-[11px] font-semibold text-ink-muted">{percentileSuffix(percentile)}</span>
              </p>
              <p className="mt-1 text-[11px] font-medium text-ink-muted">
                Rank {rank}
                <span className="text-stone-400"> / {total}</span>
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold text-ink-muted">—</p>
              <p className="mt-1 text-[11px] text-ink-muted">Only participant</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/60 pt-2.5 text-[12px]">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${percentage >= passingScore ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${percentage >= passingScore ? "bg-emerald-500" : "bg-red-500"}`} />
          {percentage >= passingScore ? "Passed" : "Failed"} · Passing {passingScore}%
        </span>
        <span className="text-ink-muted">
          {submission.answers?.length || 0} Q's · {submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—"}
        </span>
      </div>
    </div>
  );
};

const MySubmissions = () => {
  const { getAuthToken } = useAuth();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [detailLoading, setDetailLoading] = useState(null);

  useEffect(() => {
    fetchSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSubmissions = async () => {
    try {
      const token = await getAuthToken();
      const data = await examService.getMySubmissions(token);
      setSubmissions(data.submissions);
    } catch (error) {
      console.error("Error fetching submissions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = async (submission) => {
    setDetailLoading(submission._id);
    try {
      const token = await getAuthToken();
      const data = await examService.getSubmission(token, submission._id);
      setSelectedSubmission(data.submission);
    } catch (error) {
      console.error("Error fetching submission details:", error);
      setSelectedSubmission(submission);
    } finally {
      setDetailLoading(null);
    }
  };

  const handleCloseModal = () => {
    setSelectedSubmission(null);
  };

  const { page, pageCount, setPage, pagedItems } = usePagedData(
    submissions,
    PAGE_SIZE,
    loading
  );

  if (loading) {
    return (
      <AppLayout>
        <PageHeader title="My Results" subtitle="Your scores, percentages and percentile rank after the exam window closes" />
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="My Results"
        subtitle="Your scores, percentages and percentile rank after the exam window closes"
      />

      {submissions.length === 0 ? (
        <div className="mt-6 rounded-md border border-line bg-surface shadow-sm">
          <EmptyState
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            }
            title="No submissions yet"
            description="You haven't submitted any exams yet."
            action={<Button onClick={() => navigate("/dashboard")}>Go to Dashboard</Button>}
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pagedItems.map((submission) => {
              const statusCfg = getStatusConfig(submission.status);
              const isPending = !!submission.resultsPending;
              const showScores = !isPending && canShowCorrectAnswer(submission);
              const passingScore = submission.examId?.settings?.passingScore ?? 50;

              return (
                <div key={submission._id} className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-sm transition-all duration-150 hover:shadow-md hover:border-stone-300">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-semibold leading-snug text-ink">
                        {submission.examId?.title || "Exam"}
                      </h2>
                      {submission.examId?.description && (
                        <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-muted">
                          {submission.examId.description}
                        </p>
                      )}
                    </div>
                    <Badge dot variant={statusCfg.variant}>{statusCfg.label}</Badge>
                  </div>

                  <div className="mt-4">
                    {isPending ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-3">
                        <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                          Results pending
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-amber-900/80">
                          Available{" "}
                          <strong className="text-amber-900">
                            {submission.resultsReleaseAt
                              ? new Date(submission.resultsReleaseAt).toLocaleString([], {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "after the exam ends"}
                          </strong>{" "}
                          — after the window closes for everyone.
                        </p>
                        <div className="mt-2.5 flex items-center gap-3 text-xs text-amber-800/70">
                          <span>{submission.answers?.length || 0} Q's answered</span>
                          <span className="h-3 w-px bg-amber-200" />
                          <span>{submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"}</span>
                        </div>
                      </div>
                    ) : !showScores ? (
                      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-3">
                        <p className="text-[13px] font-medium text-ink">Submitted successfully</p>
                        <p className="mt-0.5 text-[13px] text-ink-muted">Score and percentile are hidden until your coordinator releases the answers.</p>
                        <div className="mt-2 text-xs text-ink-muted">{submission.answers?.length || 0} Q's · {submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"}</div>
                      </div>
                    ) : (
                      <ScoreHeroCard submission={submission} />
                    )}
                  </div>

                  {/* footer quick stats when not using hero card's footer */}
                  {isPending && (
                    <div className="mt-3 flex gap-2 text-xs">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-medium ${passingScore != null ? "border-stone-200 bg-canvas text-ink-muted" : "border-stone-200 bg-canvas text-ink-muted"}`}>
                        Passing {passingScore}%
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
                    <span className="text-xs text-ink-muted">
                      {submission.submittedAt ? `Submitted ${new Date(submission.submittedAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                    </span>
                    <Button
                      size="sm"
                      variant={showScores ? "primary" : "secondary"}
                      onClick={() => handleViewDetails(submission)}
                      disabled={detailLoading === submission._id}
                    >
                      {detailLoading === submission._id ? "Loading…" : showScores ? "View Result" : "View Details"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </>
      )}

      {/* ── Detail Modal ── */}
      <Modal
        open={!!selectedSubmission}
        onClose={handleCloseModal}
        size="lg"
        title={selectedSubmission?.examId?.title || "Exam"}
        subtitle={
          selectedSubmission && (
            <span className="flex flex-wrap items-center gap-2.5">
              <Badge dot variant={getStatusConfig(selectedSubmission.status).variant}>
                {getStatusConfig(selectedSubmission.status).label}
              </Badge>
              {selectedSubmission.resultsPending ? (
                <span className="text-sm font-medium text-amber-700">
                  Results pending — released {selectedSubmission.resultsReleaseAt ? new Date(selectedSubmission.resultsReleaseAt).toLocaleString() : "after the window closes"}
                </span>
              ) : !canShowCorrectAnswer(selectedSubmission) ? (
                <span className="text-sm font-medium text-ink-muted">Coordinator has not released detailed answers</span>
              ) : (
                <span className="text-sm font-medium text-emerald-700">
                  {selectedSubmission.percentage != null ? `${Math.round(selectedSubmission.percentage)}%` : ""} · Score {selectedSubmission.score}/{selectedSubmission.maxScore} {typeof selectedSubmission.percentile === "number" ? `· ${selectedSubmission.percentile}${percentileSuffix(selectedSubmission.percentile)} percentile` : ""}
                </span>
              )}
            </span>
          )
        }
      >
        {selectedSubmission && (
            <div className="space-y-5">
              {selectedSubmission.resultsPending && (
                <Alert variant="info">
                  Results are withheld until the exam window closes for everyone
                  {selectedSubmission.resultsReleaseAt
                    ? ` (available ${new Date(selectedSubmission.resultsReleaseAt).toLocaleString()})`
                    : ""}
                  .
                </Alert>
              )}
              {!canShowCorrectAnswer(selectedSubmission) && !selectedSubmission.resultsPending && (
                <Alert variant="info">
                  Your coordinator has not released the right answers yet — score breakdown is hidden.
                </Alert>
              )}

              {/* ── Result Hero (only when released and visible) ── */}
              {!selectedSubmission.resultsPending && canShowCorrectAnswer(selectedSubmission) && (
                <div className="rounded-xl border border-line bg-gradient-to-br from-indigo-50/80 via-white to-emerald-50/60 p-5 shadow-sm">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-5">
                      <CircleRing percentage={selectedSubmission.percentage ?? 0} size={72} />
                      <div>
                        <p className="text-sm font-medium text-ink-muted">Your Result</p>
                        <p className="mt-0.5 text-[28px] font-bold leading-none tracking-tight text-ink">
                          {selectedSubmission.score}
                          <span className="text-[18px] font-medium text-ink-muted"> / {selectedSubmission.maxScore}</span>
                        </p>
                        <p className="mt-1 text-sm font-medium" style={{ color: getPerformance(selectedSubmission.percentage).color.replace('text-','') }}>
                          <span className={getPerformance(selectedSubmission.percentage).color}>{getPerformance(selectedSubmission.percentage, selectedSubmission.examId?.settings?.passingScore).label}</span>
                          <span className="ml-2 text-ink-muted font-normal">{Math.round(selectedSubmission.percentage)}% · {selectedSubmission.examId?.settings?.passingScore != null ? `${selectedSubmission.percentage >= selectedSubmission.examId.settings.passingScore ? "Passed" : "Failed"} (passing ${selectedSubmission.examId.settings.passingScore}%)` : ""}</span>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:min-w-[220px]">
                      <div className="rounded-lg border border-line bg-white px-4 py-3 text-center">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Percentile</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-ink">
                          {typeof selectedSubmission.percentile === "number" ? (
                            <>{selectedSubmission.percentile}<span className="align-super text-[11px] font-semibold text-ink-muted">{percentileSuffix(selectedSubmission.percentile)}</span></>
                          ) : "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {selectedSubmission.rank && selectedSubmission.totalParticipants
                            ? `Rank ${selectedSubmission.rank} of ${selectedSubmission.totalParticipants}`
                            : selectedSubmission.totalParticipants === 1
                            ? "Only participant"
                            : "—"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-white px-4 py-3 text-center">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Accuracy</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-ink">{Math.round(selectedSubmission.percentage)}%</p>
                        <p className="mt-0.5 text-xs text-ink-muted">{selectedSubmission.answers?.filter(a=> a.isCorrect || a.marksAwarded>0).length || 0} / {selectedSubmission.answers?.length || 0} correct</p>
                      </div>
                    </div>
                  </div>

                  {/* progress bars */}
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-ink-muted">Percentage</span><span className="font-semibold tabular-nums text-ink">{Math.round(selectedSubmission.percentage)}%</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-stone-200">
                        <div className={`h-full rounded-full ${getPerformance(selectedSubmission.percentage).bar}`} style={{ width: `${Math.min(100, Math.max(0, selectedSubmission.percentage))}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-ink-muted">Percentile</span><span className="font-semibold tabular-nums text-ink">{typeof selectedSubmission.percentile === "number" ? `${selectedSubmission.percentile}th` : "—"}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-stone-200">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${typeof selectedSubmission.percentile === "number" ? selectedSubmission.percentile : 0}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-ink-muted">You scored higher than {selectedSubmission.percentile ?? 0}% of participants</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line/60 pt-3 text-xs text-ink-muted">
                    <span>Submitted {selectedSubmission.submittedAt ? new Date(selectedSubmission.submittedAt).toLocaleString() : "—"}</span>
                    {selectedSubmission.reviewedBy && <><span className="text-stone-300">·</span><span>Reviewed by {selectedSubmission.reviewedBy?.name || "Coordinator"}</span></>}
                    {selectedSubmission.totalParticipants ? <><span className="text-stone-300">·</span><span>{selectedSubmission.totalParticipants} participants</span></> : null}
                  </div>
                </div>
              )}

            {/* fallback minimal summary when gated but we still want score date */}
            {selectedSubmission.resultsPending && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Your submission is recorded</p>
                <p className="mt-1 text-amber-800/80">You answered {selectedSubmission.answers?.length || 0} questions. Score, percentage and percentile will appear here after the window closes.</p>
              </div>
            )}

            <div className="space-y-6">
              {(() => {
                const questions = selectedSubmission.examId?.questions || [];
                const groups = buildSectionGroups(
                  questions,
                  selectedSubmission.examId?.sections
                );
                const nameById = sectionNamesById(
                  selectedSubmission.examId?.sections
                );
                const showCorrect = canShowCorrectAnswer(selectedSubmission) && !selectedSubmission.resultsPending;

                const renderQuestionCard = (question, index) => {
                  const answer = selectedSubmission.answers?.find(
                    (a) => String(a.questionId) === String(question._id)
                  );
                  const isCorrect = answer?.isCorrect || (answer?.marksAwarded > 0);
                  const awarded = answer?.marksAwarded || 0;

                  return (
                    <div
                      key={question._id || index}
                      className={`rounded-lg border p-4 ${
                        showCorrect
                          ? isCorrect
                            ? "border-emerald-200 bg-emerald-50/40"
                            : "border-red-200 bg-red-50/30"
                          : "border-line bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary-light text-xs font-semibold text-ink">
                            {index + 1}
                          </span>
                          <span className="truncate text-xs uppercase tracking-wide text-ink-muted">
                            {question.type?.replace(/_/g, " ")}
                          </span>
                        </div>
                        <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${showCorrect ? (isCorrect ? "text-success" : "text-danger") : "text-ink-muted"}`}>
                          {showCorrect ? `${awarded} / ${question.points} pts` : `${question.points} pts`}
                        </span>
                      </div>

                      <p className="mt-2.5 text-sm leading-relaxed text-ink">{question.question}</p>

                      <div className={`mt-3 grid gap-3 ${showCorrect ? "sm:grid-cols-2" : ""}`}>
                        <div className="rounded-md border border-line bg-surface p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Your Answer</p>
                          <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${
                            showCorrect ? (isCorrect ? "text-success" : "text-danger") : "text-ink"
                          }`}>
                            {answer?.answer || "(No answer provided)"}
                          </p>
                        </div>
                        {showCorrect && (
                          <div className="rounded-md border border-line bg-surface p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Correct Answer</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
                              {question.modelAnswer || question.correctAnswer || "—"}
                            </p>
                          </div>
                        )}
                      </div>

                      {answer?.gradingMethod && showCorrect && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {answer.gradingMethod === "manual" && (
                            <Badge variant="neutral">Manually graded</Badge>
                          )}
                          {answer.gradingMethod === "manual_review" && (
                            <Badge variant="warning">
                              {answer.gradingStatus === "graded" ? "Reviewed by coordinator" : "Pending coordinator review"}
                            </Badge>
                          )}
                          {answer.gradingMethod === "exact_match" && (
                            <Badge variant="success">Auto-graded</Badge>
                          )}
                        </div>
                      )}

                      {showCorrect && question.explanation && (
                        <div className="mt-3 rounded-md bg-canvas px-3 py-2 text-[13px] leading-relaxed text-stone-600">
                          <strong className="font-semibold text-ink">Explanation:</strong>{" "}
                          {question.explanation}
                        </div>
                      )}
                    </div>
                  );
                };

                // No sectioning on this exam — one continuous list.
                if (groups.length === 0) {
                  return (
                    <div className="space-y-4">
                      {questions.map(renderQuestionCard)}
                    </div>
                  );
                }

                // Section-wise grouping; numbering stays global (1..N).
                return groups.map((group) => (
                  <section key={group.key}>
                    <div className="flex items-center justify-between gap-3 border-b border-line pb-1.5">
                      <h4 className="truncate text-[13px] font-semibold uppercase tracking-wide text-ink">
                        {nameById.get(group.key) || group.name}
                      </h4>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {group.indices.length} question{group.indices.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="mt-3 space-y-4">
                      {group.indices.map((qIndex) => renderQuestionCard(questions[qIndex], qIndex))}
                    </div>
                  </section>
                ));
              })()}
            </div>

            <div className="border-t border-line pt-4 text-[13px] text-ink-muted">
              <p>
                <strong className="text-ink">Submitted On:</strong>{" "}
                {selectedSubmission.submittedAt
                  ? new Date(selectedSubmission.submittedAt).toLocaleString()
                  : "Not submitted"}
              </p>
              {selectedSubmission.reviewedBy && (
                <p className="mt-1">
                  <strong className="text-ink">Reviewed By:</strong>{" "}
                  {selectedSubmission.reviewedBy?.name || "Coordinator"}
                </p>
              )}
              {selectedSubmission.reviewNotes && (
                <div className="mt-2 rounded-md bg-canvas px-3 py-2">
                  <strong className="text-ink">Reviewer Notes:</strong>
                  <p className="mt-0.5">{selectedSubmission.reviewNotes}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
};

export default MySubmissions;
