import React, { useState, useEffect, useCallback, useMemo, memo, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { examService } from "../services/examService";

import AppLayout from "../components/AppLayout";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import { Textarea } from "../components/ui/Input";
import Skeleton from "../components/ui/Skeleton";
import Pagination from "../components/ui/Pagination";
import usePagedData from "../hooks/usePagedData";
import { Table, THead, TRHead, TH, TBody, TR, TD } from "../components/ui/Table";
import { QuestionBody } from "../components/RichContent";

const VideoPlayer = React.lazy(() => import("../components/VideoPlayer"));

const PAGE_SIZE = 25;

const STATUS_VARIANTS = {
  in_progress: "neutral",
  submitted: "success",
  grading: "warning",
  graded: "accent",
  partially_graded: "warning",
  locked: "danger",
};

const getStatusLabel = (status) => {
  const labels = {
    in_progress: "In Progress",
    submitted: "Submitted",
    grading: "Pending Review…",
    graded: "Graded",
    partially_graded: "Needs Review",
    locked: "Locked",
  };
  return labels[status] || status;
};

/** Determine answer correctness from backend fields, not raw string match */
const getAnswerStatus = (answer) => {
  if (!answer) return { isCorrect: false, awarded: 0 };
  return {
    isCorrect: answer.isCorrect || answer.marksAwarded > 0,
    awarded: answer.marksAwarded || 0,
  };
};

const trustTone = (score) =>
  score < 50 ? "text-danger" : score < 75 ? "text-warning" : "text-success";

const RowSkeleton = () => (
  <div className="space-y-3">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 rounded-md border border-line bg-surface px-4 py-3.5">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="hidden h-3.5 w-24 sm:block" />
      </div>
    ))}
  </div>
);

const SubmissionRow = memo(function SubmissionRow({ submission, onView }) {
  const variant = submission.isFlagged
    ? "danger"
    : STATUS_VARIANTS[submission.status] || "neutral";

  const flagCount = (n) =>
    n > 0 ? (
      <span className="inline-flex items-center gap-1 font-medium text-warning">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {n}
      </span>
    ) : (
      <span className="tabular-nums">{n}</span>
    );

  const trust = submission.proctoringScore || 100;

  return (
    <TR>
      <TD>
        <p className="font-medium text-ink">{submission.studentId?.name || "Unknown"}</p>
        <p className="text-xs text-ink-muted">{submission.studentId?.email}</p>
      </TD>
      <TD>
        <Badge dot variant={variant}>{getStatusLabel(submission.status)}</Badge>
      </TD>
      <TD className="tabular-nums">
        {submission.status === "grading" ? (
          <span className="text-warning">Pending Review…</span>
        ) : submission.status === "partially_graded" ? (
          <span className="text-warning">
            {submission.score}/{submission.maxScore} (Partial)
          </span>
        ) : (
          <span className={`font-medium ${submission.percentage >= 50 ? "text-success" : "text-danger"}`}>
            {submission.score}/{submission.maxScore} ({submission.percentage}%)
          </span>
        )}
      </TD>
      <TD>{flagCount(submission.tabSwitchCount)}</TD>
      <TD>{flagCount(submission.fullscreenExitCount)}</TD>
      <TD>
        <span className={`font-semibold tabular-nums ${trustTone(trust)}`}>{trust}%</span>
      </TD>
      <TD className="whitespace-nowrap text-[13px] text-ink-muted">
        {submission.submittedAt
          ? new Date(submission.submittedAt).toLocaleString()
          : "Not submitted"}
      </TD>
      <TD>
        <Button size="sm" variant="secondary" onClick={() => onView(submission)}>
          View Details
        </Button>
      </TD>
    </TR>
  );
});


const ExamSubmissions = () => {
  const { examId } = useParams();
  const { getAuthToken } = useAuth();
  const navigate = useNavigate();

  // Core data
  const [exam, setExam] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Violation clips from proctoring session
  const [violationClips, setViolationClips] = useState([]);

  // Override state
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [editMarks, setEditMarks] = useState("");
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [editingTotalScore, setEditingTotalScore] = useState(false);
  const [editTotalMarks, setEditTotalMarks] = useState("");
  const [totalOverrideReason, setTotalOverrideReason] = useState("");

  // Answer-key bulk fix state (good styling panel)
  const [fixDrafts, setFixDrafts] = useState({}); // { [questionId]: newCorrectAnswer }
  const [fixLoadingId, setFixLoadingId] = useState(null);
  const [lastFixResult, setLastFixResult] = useState(null);

  // Toast notification
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Data fetching ──────────────────────────────────────────────
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  const fetchData = async () => {
    try {
      const token = await getAuthToken();
      const [examData, submissionsData] = await Promise.all([
        examService.getExam(token, examId),
        examService.getSubmissions(token, examId),
      ]);

      setExam(examData.exam);
      setSubmissions(submissionsData.submissions);
      setStats(submissionsData.stats);
    } catch (error) {
      console.error("Error fetching data:", error);
      showToast("Error loading submissions", "error");
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  // Refresh submission detail without closing modal
  const refreshSubmissionDetail = async (submissionId) => {
    try {
      const token = await getAuthToken();
      const data = await examService.getSubmission(token, submissionId);
      setSelectedSubmission(data.submission);
      setReviewNotes(data.submission.reviewNotes || "");
    } catch (error) {
      console.error("Error refreshing submission:", error);
    }
  };

  // ── Handlers ───────────────────────────────────────────────────
  const handleViewSubmission = async (submission) => {
    try {
      const token = await getAuthToken();
      const data = await examService.getSubmission(token, submission._id);
      setSelectedSubmission(data.submission);
      setReviewNotes(data.submission.reviewNotes || "");
      // Reset override state
      setEditingQuestionId(null);
      setEditMarks("");
      setEditingTotalScore(false);
      setEditTotalMarks("");
      setTotalOverrideReason("");

      // Fetch violation clips from the proctoring session
      try {
        const procData = await examService.getSessionBySubmission(token, submission._id);
        setViolationClips(procData.session?.violationClips || []);
      } catch {
        setViolationClips([]);
      }
    } catch {
      showToast("Error loading submission details", "error");
    }
  };

  const handleCloseModal = () => {
    setSelectedSubmission(null);
    setEditingQuestionId(null);
    setEditMarks("");
    setEditingTotalScore(false);
    setEditTotalMarks("");
    setTotalOverrideReason("");
    setViolationClips([]);
  };

  const handleReviewSubmission = async (isFlagged) => {
    if (!selectedSubmission) return;
    try {
      const token = await getAuthToken();
      await examService.reviewSubmission(token, selectedSubmission._id, {
        reviewNotes,
        isFlagged,
        flagReason: isFlagged ? reviewNotes : undefined,
      });

      showToast(
        isFlagged ? "Submission flagged for review" : "Submission approved",
        "success"
      );
      handleCloseModal();
      fetchData();
    } catch (error) {
      showToast("Error reviewing submission: " + error.message, "error");
    }
  };

  // ── Per-question manual grade override ─────────────────────────
  const startQuestionOverride = (questionId, currentMarks) => {
    setEditingQuestionId(questionId);
    setEditMarks(String(currentMarks || 0));
  };

  const cancelQuestionOverride = () => {
    setEditingQuestionId(null);
    setEditMarks("");
  };

  const handleOverrideGrade = async (questionId, maxPoints) => {
    const marks = parseFloat(editMarks);
    if (isNaN(marks) || marks < 0 || marks > maxPoints) {
      showToast(`Enter a valid score between 0 and ${maxPoints}`, "error");
      return;
    }

    setOverrideLoading(true);
    try {
      const token = await getAuthToken();
      await examService.overrideGrade(
        token,
        selectedSubmission._id,
        questionId,
        marks
      );
      showToast(`Grade updated to ${marks}/${maxPoints}`, "success");
      cancelQuestionOverride();
      await refreshSubmissionDetail(selectedSubmission._id);
      fetchData();
    } catch (error) {
      showToast(
        "Error overriding grade: " +
          (error.response?.data?.message || error.message),
        "error"
      );
    } finally {
      setOverrideLoading(false);
    }
  };

  // ── Total score override ───────────────────────────────────────
  const startTotalScoreOverride = () => {
    setEditingTotalScore(true);
    setEditTotalMarks(String(selectedSubmission.score));
    setTotalOverrideReason("");
  };

  const cancelTotalScoreOverride = () => {
    setEditingTotalScore(false);
    setEditTotalMarks("");
    setTotalOverrideReason("");
  };

  const handleOverrideTotalScore = async () => {
    const newScore = parseFloat(editTotalMarks);
    if (
      isNaN(newScore) ||
      newScore < 0 ||
      newScore > selectedSubmission.maxScore
    ) {
      showToast(
        `Enter a valid score between 0 and ${selectedSubmission.maxScore}`,
        "error"
      );
      return;
    }

    setOverrideLoading(true);
    try {
      const token = await getAuthToken();
      await examService.overrideTotalScore(
        token,
        selectedSubmission._id,
        newScore,
        totalOverrideReason || undefined
      );
      showToast(
        `Total score updated to ${newScore}/${selectedSubmission.maxScore}`,
        "success"
      );
      cancelTotalScoreOverride();
      await refreshSubmissionDetail(selectedSubmission._id);
      fetchData();
    } catch (error) {
      showToast(
        "Error overriding total score: " +
          (error.response?.data?.message || error.message),
        "error"
      );
    } finally {
      setOverrideLoading(false);
    }
  };


  // ── Bulk answer-key correction ───────────────────────────────
  const handleFixAnswerKey = async (questionId) => {
    const newVal = fixDrafts[questionId];
    if (!newVal || !String(newVal).trim()) {
      showToast("Select a correct option first", "error");
      return;
    }
    const q = exam?.questions?.find((qq) => String(qq._id) === String(questionId));
    if (q && String(q.correctAnswer) === String(newVal).trim()) {
      showToast("That is already the current answer key", "error");
      return;
    }
    if (!window.confirm(`Change correct answer to "${newVal}" and regrade ALL submissions for this question? This updates everyone’s score.`)) return;
    setFixLoadingId(questionId);
    try {
      const token = await getAuthToken();
      const res = await examService.fixAnswerKey(token, examId, questionId, String(newVal).trim());
      showToast(res.message || `Regraded ${res.affected} submission(s)`, "success");
      setLastFixResult({ questionId, affected: res.affected, at: new Date().toLocaleTimeString(), value: newVal });
      // refresh exam + submissions
      const [examData, submissionsData] = await Promise.all([
        examService.getExam(token, examId),
        examService.getSubmissions(token, examId),
      ]);
      setExam(examData.exam);
      setSubmissions(submissionsData.submissions);
      setStats(submissionsData.stats);
      if (selectedSubmission) await refreshSubmissionDetail(selectedSubmission._id);
    } catch (error) {
      showToast(error.response?.data?.message || error.message, "error");
    } finally {
      setFixLoadingId(null);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────
  const filteredSubmissions = useMemo(
    () =>
      submissions.filter((s) => {
        if (filterStatus === "all") return true;
        if (filterStatus === "flagged") return s.isFlagged;
        if (filterStatus === "graded") return s.status === "graded" || s.status === "submitted";
        if (filterStatus === "partially_graded") return s.status === "partially_graded" || s.status === "grading";
        return s.status === filterStatus;
      }),
    [submissions, filterStatus]
  );

  const { page, pageCount, setPage, pagedItems } = usePagedData(
    filteredSubmissions,
    PAGE_SIZE,
    filterStatus
  );

  // ── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout maxWidth="max-w-7xl">
        <PageHeader
          title={exam?.title ? `${exam.title} — Submissions` : "Submissions"}
          subtitle={exam ? `Duration: ${exam.duration} min · Questions: ${exam.questions?.length}` : "Loading…"}
          actions={<Button variant="secondary" onClick={() => navigate("/dashboard")}>← Back to Dashboard</Button>}
        />
        <div className="mt-6">
          <RowSkeleton />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout maxWidth="max-w-7xl">
      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[60] rounded-sm px-4 py-2.5 text-sm font-medium text-white shadow-md ${
            toast.type === "error" ? "bg-danger" : "bg-primary"
          }`}
        >
          {toast.message}
        </div>
      )}

      <PageHeader
        title={`${exam?.title} — Submissions`}
        subtitle={`Duration: ${exam?.duration} min · Questions: ${exam?.questions?.length}`}
        actions={<Button variant="secondary" onClick={() => navigate("/dashboard")}>← Back to Dashboard</Button>}
      />

      {/* ── Stats Bar ── */}
      {stats && (
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            ["Total", stats.total, "text-ink"],
            ["Submitted", stats.submitted, "text-success"],
            ["In Progress", stats.inProgress, "text-warning"],
            ["Flagged", stats.flagged, stats.flagged > 0 ? "text-danger" : "text-ink"],
            ["Avg Score", `${stats.averageScore}%`, "text-ink"],
            ["Highest", `${stats.highestScore}%`, "text-success"],
            ["Lowest", `${stats.lowestScore}%`, "text-danger"],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-md border border-line bg-surface px-4 py-3 shadow-sm">
              <dd className={`text-xl font-bold tabular-nums leading-none ${tone}`}>{value}</dd>
              <dt className="mt-1 text-xs text-ink-muted">{label}</dt>
            </div>
          ))}
        </dl>
      )}

      {/* ── Answer Key Correction — polished bulk fix ── */}
      {exam?.questions?.length > 0 && (
        <details className="group mt-6 overflow-hidden rounded-md border border-amber-200 bg-amber-50/70 shadow-sm" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-gradient-to-r from-amber-50 to-orange-50/40 px-4 py-3 hover:from-amber-100/60 hover:to-orange-50/60 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-amber-500 text-white shadow-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/><path d="M12 3v2M12 19v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/><path d="M9 12h6"/></svg>
              </span>
              <span>
                <span className="block text-[13px] font-semibold tracking-wide text-amber-900">Answer Key Correction</span>
                <span className="block text-xs font-normal text-amber-800/70">Wrong option? Fix the correct answer here — every student’s score is recalculated instantly</span>
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="warning">{exam.questions.length} Qs</Badge>
              <span className="hidden text-xs font-medium text-amber-700 group-open:hidden sm:inline">Show</span>
              <span className="hidden text-xs font-medium text-amber-700 group-open:inline sm:inline">Hide</span>
              <svg className="h-4 w-4 text-amber-700 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </span>
          </summary>
          <div className="border-t border-amber-200 bg-surface px-4 py-4 sm:px-5">
            {lastFixResult && (
              <div className="mb-4 flex items-center gap-2 rounded-sm border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-800">
                <span className="h-2 w-2 rounded-full bg-green-500"/> Last fix: Q{exam.questions.findIndex(q=>String(q._id)===String(lastFixResult.questionId))+1} → “{lastFixResult.value}” · {lastFixResult.affected} regraded · {lastFixResult.at}
              </div>
            )}
            <div className="space-y-3">
              {exam.questions.map((q, idx) => {
                const draft = fixDrafts[q._id] ?? q.correctAnswer;
                const isChanged = String(draft).trim() !== String(q.correctAnswer).trim();
                const isMcq = q.type === "mcq" || q.type === "true_false";
                return (
                  <div key={q._id} className={`rounded-md border p-3.5 transition ${isChanged ? "border-amber-300 bg-amber-50/40 shadow-sm" : "border-line bg-canvas"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-ink text-xs font-bold text-white">{idx+1}</span>
                          <Badge variant="neutral">{q.type.replace(/_/g," ")}</Badge>
                          <span className="text-xs tabular-nums text-ink-muted">{q.points} pt{q.points!==1?"s":""}</span>
                          {isChanged && <Badge variant="warning">unsaved change</Badge>}
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-ink">{q.question}</p>
                        {isMcq && Array.isArray(q.options) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {q.options.map((opt) => (
                              <span key={opt} className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${opt===q.correctAnswer ? "border-green-300 bg-green-50 text-green-800" : "border-line bg-surface text-ink-muted"}`}>
                                {opt===q.correctAnswer && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500"/>}
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                        {!isMcq && (
                          <p className="mt-1.5 rounded-sm border border-dashed border-line bg-surface px-2.5 py-1.5 text-xs text-ink-muted">Current key: <span className="font-semibold text-ink">{q.correctAnswer || "—"}</span></p>
                        )}
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:w-64 sm:shrink-0">
                        <label className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Correct answer</label>
                        {isMcq ? (
                          <select
                            value={draft}
                            onChange={(e)=> setFixDrafts(prev=> ({...prev, [q._id]: e.target.value}))}
                            className="h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-sm text-ink focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                          >
                            {q.options.map(opt=> <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : (
                          <input
                            value={draft}
                            onChange={(e)=> setFixDrafts(prev=> ({...prev, [q._id]: e.target.value}))}
                            placeholder="Correct answer"
                            className="h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                          />
                        )}
                        <Button
                          size="sm"
                          onClick={()=> handleFixAnswerKey(q._id)}
                          disabled={fixLoadingId===q._id || !isChanged}
                          className={isChanged ? "!bg-amber-600 hover:!bg-amber-700 !text-white disabled:!bg-stone-200" : ""}
                        >
                          {fixLoadingId===q._id ? "Regrading…" : "Apply to all students"}
                        </Button>
                        <p className="text-[11px] leading-tight text-ink-muted">Updates {submissions.filter(s=> s.status!=="in_progress").length} graded submissions</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-ink-muted">Tip: this overwrites any prior per-student overrides for that question so the new key is authoritative.</p>
          </div>
        </details>
      )}

      {/* ── Filter ── */}
      <div className="mt-5 flex items-center gap-2.5">
        <label htmlFor="submission-filter" className="text-sm font-medium text-ink">
          Filter:
        </label>
        <select
          id="submission-filter"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-9 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        >
          <option value="all">All ({submissions.length})</option>
          <option value="graded">Graded ({submissions.filter((s) => s.status === "graded" || s.status === "submitted").length})</option>
          <option value="partially_graded">Needs Review ({submissions.filter((s) => s.status === "partially_graded" || s.status === "grading").length})</option>
          <option value="in_progress">In Progress ({submissions.filter((s) => s.status === "in_progress").length})</option>
          <option value="flagged">Flagged ({submissions.filter((s) => s.isFlagged).length})</option>
          <option value="locked">Locked ({submissions.filter((s) => s.status === "locked").length})</option>
        </select>
      </div>

      {/* ── Submissions Table ── */}
      <div className="mt-4">
        {filteredSubmissions.length === 0 ? (
          <div className="rounded-md border border-line bg-surface shadow-sm">
            <EmptyState
              icon={
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" />
                </svg>
              }
              title="No submissions found"
              description="No submissions match the current filter."
            />
          </div>
        ) : (
          <>
            <Table>
              <THead>
                <TRHead>
                  <TH>Student</TH>
                  <TH>Status</TH>
                  <TH>Score</TH>
                  <TH>Tab Switches</TH>
                  <TH>FS Exits</TH>
                  <TH>Trust Score</TH>
                  <TH>Submitted</TH>
                  <TH className="text-right">Actions</TH>
                </TRHead>
              </THead>
              <TBody>
                {pagedItems.map((submission) => (
                  <SubmissionRow
                    key={submission._id}
                    submission={submission}
                    onView={handleViewSubmission}
                  />
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SUBMISSION DETAIL MODAL
          ═══════════════════════════════════════════════════════════════ */}
      <Modal
        open={!!selectedSubmission}
        onClose={handleCloseModal}
        size="xl"
        title={selectedSubmission?.studentId?.name || "Unknown Student"}
        subtitle={
          selectedSubmission && (
            <span className="flex flex-wrap items-center gap-2">
              {selectedSubmission.studentId?.email} ·{" "}
              <Badge dot variant={STATUS_VARIANTS[selectedSubmission.status] || "neutral"}>
                {getStatusLabel(selectedSubmission.status)}
              </Badge>
            </span>
          )
        }
      >
        {selectedSubmission && (
          <div className="space-y-6">
            {/* ── Score Overview Card ── */}
            <section className="rounded-md border border-line bg-canvas p-4 sm:p-5">
              {editingTotalScore ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-36">
                      <label className="mb-1.5 block text-sm font-medium text-ink">New Total Score</label>
                      <input
                        type="number"
                        value={editTotalMarks}
                        onChange={(e) => setEditTotalMarks(e.target.value)}
                        min={0}
                        max={selectedSubmission.maxScore}
                        step="0.5"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleOverrideTotalScore();
                          if (e.key === "Escape") cancelTotalScoreOverride();
                        }}
                        className="h-10 w-full rounded-sm border border-line bg-surface px-3 text-sm tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                      />
                    </div>
                    <span className="pb-2.5 text-sm text-ink-muted">/ {selectedSubmission.maxScore}</span>
                  </div>
                  <input
                    type="text"
                    value={totalOverrideReason}
                    onChange={(e) => setTotalOverrideReason(e.target.value)}
                    placeholder="Reason (optional), e.g. Corrected marking error"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleOverrideTotalScore();
                    }}
                    className="h-10 w-full max-w-md rounded-sm border border-line bg-surface px-3 text-sm text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                  />
                  <div className="flex gap-2.5 pt-1">
                    <Button size="sm" onClick={handleOverrideTotalScore} disabled={overrideLoading}>
                      {overrideLoading ? "Saving…" : "Save Score"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={cancelTotalScoreOverride} disabled={overrideLoading}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="text-[34px] font-bold leading-none tracking-tight tabular-nums">
                    <span className={selectedSubmission.percentage >= 50 ? "text-success" : "text-danger"}>
                      {selectedSubmission.score}
                    </span>
                    <span className="mx-1 text-lg font-normal text-stone-400">/</span>
                    <span className="text-lg text-ink-muted">{selectedSubmission.maxScore}</span>
                  </p>

                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Tab Switches</p>
                      <p className={`font-semibold tabular-nums ${selectedSubmission.tabSwitchCount > 3 ? "text-warning" : "text-ink"}`}>
                        {selectedSubmission.tabSwitchCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">FS Exits</p>
                      <p className={`font-semibold tabular-nums ${selectedSubmission.fullscreenExitCount > 2 ? "text-warning" : "text-ink"}`}>
                        {selectedSubmission.fullscreenExitCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Trust Score</p>
                      <p className={`font-semibold tabular-nums ${trustTone(selectedSubmission.proctoringScore || 100)}`}>
                        {selectedSubmission.proctoringScore || 100}%
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">Submitted</p>
                      <p className="font-medium text-ink">
                        {selectedSubmission.submittedAt
                          ? new Date(selectedSubmission.submittedAt).toLocaleString()
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <Button size="sm" variant="secondary" onClick={startTotalScoreOverride} title="Override total score">
                    Override Score
                  </Button>
                </div>
              )}
            </section>

            {/* ── Answers Section ── */}
            <section>
              <h3 className="mb-3 text-[15px] font-semibold text-ink">
                Answers &amp; Grading{" "}
                <span className="font-normal text-ink-muted">
                  · {exam?.questions?.length} question{exam?.questions?.length !== 1 ? "s" : ""}
                </span>
              </h3>
              <div className="space-y-3">
                {exam?.questions?.map((question, index) => {
                  const answer = selectedSubmission.answers?.find(
                    (a) => String(a.questionId) === String(question._id)
                  );
                  const { isCorrect, awarded } = getAnswerStatus(answer);
                  const isEditing = editingQuestionId === question._id;

                  return (
                    <div
                      key={question._id}
                      className={`rounded-md border p-4 ${
                        isCorrect ? "border-green-200 bg-green-50/40" : "border-red-200 bg-red-50/30"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary-light text-xs font-semibold text-ink">
                            {index + 1}
                          </span>
                          <Badge variant="neutral">{question.type?.replace(/_/g, " ")}</Badge>
                        </div>
                        <Badge variant={isCorrect ? "success" : "danger"}>
                          {awarded}/{question.points} pt{question.points !== 1 ? "s" : ""}
                        </Badge>
                      </div>

                      <div className="mt-2.5 text-sm leading-relaxed text-ink">
                        <QuestionBody question={question} />
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-sm border border-line bg-surface p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Student's Answer</p>
                          <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${isCorrect ? "text-success" : "text-danger"}`}>
                            {answer?.answer || "(No answer)"}
                          </p>
                        </div>
                        <div className="rounded-sm border border-line bg-surface p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Correct / Model Answer</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
                            {question.modelAnswer || question.correctAnswer}
                          </p>
                        </div>
                      </div>

                      {(answer?.gradingMethod === "manual_review" ||
                        answer?.gradingMethod === "manual" ||
                        answer?.gradingMethod === "exact_match") && (
                        <div className="mt-3">
                          {answer.gradingMethod === "manual_review" && (
                            <Badge variant="warning">
                              Coordinator Review · {answer.gradingStatus === "graded" ? "Reviewed" : "Pending"} ·{" "}
                              {answer.marksAwarded}/{question.points}
                            </Badge>
                          )}
                          {answer.gradingMethod === "manual" && (
                            <Badge variant="neutral">Coordinator override — {answer.marksAwarded}/{question.points}</Badge>
                          )}
                          {answer.gradingMethod === "exact_match" && (
                            <Badge variant="success">Auto-graded — exact match · {answer.marksAwarded}/{question.points}</Badge>
                          )}
                        </div>
                      )}

                      {/* Override Controls */}
                      <div className="mt-3 border-t border-line pt-3">
                        {isEditing ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium text-ink">New Score</label>
                              <input
                                type="number"
                                value={editMarks}
                                onChange={(e) => setEditMarks(e.target.value)}
                                min={0}
                                max={question.points}
                                step="0.5"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleOverrideGrade(question._id, question.points);
                                  if (e.key === "Escape") cancelQuestionOverride();
                                }}
                                className="h-9 w-24 rounded-sm border border-line bg-surface px-2.5 text-sm tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                              />
                              <span className="text-sm text-ink-muted">/ {question.points}</span>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleOverrideGrade(question._id, question.points)}
                                disabled={overrideLoading}
                              >
                                Save
                              </Button>
                              <Button size="sm" variant="secondary" onClick={cancelQuestionOverride} disabled={overrideLoading}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => startQuestionOverride(question._id, answer?.marksAwarded)}
                            className="text-[13px] font-medium text-accent-dark underline-offset-2 transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                          >
                            Override Grade
                          </button>
                            <span className="text-stone-300">·</span>
                            <button
                              type="button"
                              onClick={() => {
                                const cur = fixDrafts[question._id] ?? question.correctAnswer;
                                if (String(cur) === String(answer?.answer || "")) {
                                  showToast("Student already has this answer — key is elsewhere", "error");
                                  return;
                                }
                                // prefill draft with student's answer and scroll to correction panel
                                setFixDrafts(prev=> ({...prev, [question._id]: answer?.answer || question.correctAnswer}));
                                showToast(`Prefilled correction for Q${index+1} — use “Apply to all students” above`, "success");
                              }}
                              className="text-[13px] font-medium text-amber-700 underline-offset-2 hover:text-amber-800 hover:underline"
                              title="Fix answer key for everyone to this student's choice"
                            >
                              Fix key to this answer (for all)
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Proctoring Events (collapsed by default - on-demand) ── */}
            {selectedSubmission.proctoringEvents?.length > 0 && (
              <details className="group rounded-md border border-line bg-surface">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink hover:bg-canvas [&::-webkit-details-marker]:hidden">
                  <span>Proctoring Events ({selectedSubmission.proctoringEvents.length})</span>
                  <span className="text-xs text-ink-muted group-open:hidden">Show</span>
                  <span className="hidden text-xs text-ink-muted group-open:inline">Hide</span>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {selectedSubmission.proctoringEvents.map((event, index) => (
                    <li key={index} className="flex items-center gap-3 px-4 py-2.5 text-sm odd:bg-canvas">
                      <span className="w-20 shrink-0 text-xs tabular-nums text-ink-muted">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="min-w-0 flex-1 truncate capitalize text-ink">
                        {event.type?.replace(/_/g, " ")}
                      </span>
                      <Badge variant={event.severity === "high" ? "danger" : event.severity === "medium" ? "warning" : "neutral"}>
                        {event.severity}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* ── Violation Clips (collapsed - only if you need to review) ── */}
            <details className="group rounded-md border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink hover:bg-canvas [&::-webkit-details-marker]:hidden">
                <span>Violation Clips ({violationClips.length})</span>
                <span className="text-xs text-ink-muted group-open:hidden">Show</span>
                <span className="hidden text-xs text-ink-muted group-open:inline">Hide</span>
              </summary>
              <div className="border-t border-line p-4">
                {violationClips.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {violationClips.map((clip, index) => (
                      <div key={index} className="overflow-hidden rounded-md border border-line">
                        <div className="flex items-center justify-between gap-2 bg-canvas px-3 py-2 text-xs">
                          <span className="truncate font-medium capitalize text-ink">
                            {clip.eventType ? clip.eventType.replace(/_/g, " ") : "violation"}
                          </span>
                          <span className="shrink-0 tabular-nums text-ink-muted">
                            {new Date(clip.timestamp).toLocaleTimeString()} · {clip.duration || 10}s
                          </span>
                        </div>
                        <Suspense fallback={<div className="aspect-video animate-pulse bg-stone-200" />}>
                          <VideoPlayer src={clip.url} />
                        </Suspense>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] italic text-ink-muted">
                    No violation clips were recorded for this session.
                  </p>
                )}
              </div>
            </details>

            {/* ── Staff Review (optional, on-demand) ── */}
            <details className="group rounded-md border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink hover:bg-canvas [&::-webkit-details-marker]:hidden">
                <span>Staff Review &amp; Override</span>
                <span className="text-xs font-normal text-ink-muted group-open:hidden">Optional - click to override</span>
                <span className="hidden text-xs font-normal text-ink-muted group-open:inline">Hide</span>
              </summary>
              <div className="border-t border-line p-4">
                <p className="mb-2.5 text-[13px] text-ink-muted">Only open this if you need to override a score or flag/approve. Leave closed otherwise - no action required.</p>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add review notes for this submission…"
                  rows={3}
                />

                {selectedSubmission.reviewedBy && (
                  <p className="mt-2 text-[13px] text-ink-muted">
                    Last reviewed by {selectedSubmission.reviewedBy.name} on{" "}
                    {new Date(selectedSubmission.reviewedAt).toLocaleString()}
                  </p>
                )}

              {/* Lock Info */}
              {selectedSubmission.status === "locked" && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50/60 p-4">
                  <h4 className="text-sm font-semibold text-danger">This exam was auto-locked</h4>
                  <p className="mt-1 text-[13px] text-ink">
                    <strong>Reason:</strong>{" "}
                    {selectedSubmission.lockInfo?.lockReason || "Max violations reached"}
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink">
                    <strong>Locked at:</strong>{" "}
                    {selectedSubmission.lockInfo?.lockedAt
                      ? new Date(selectedSubmission.lockInfo.lockedAt).toLocaleString()
                      : "Unknown"}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Unlock this submission? It will move to 'submitted' status for grading."
                        )
                      )
                        return;
                      try {
                        const token = await getAuthToken();
                        await examService.unlockSubmission(
                          token,
                          selectedSubmission._id
                        );
                        showToast("Submission unlocked", "success");
                        await refreshSubmissionDetail(selectedSubmission._id);
                        fetchData();
                      } catch (error) {
                        showToast(
                          "Error unlocking: " +
                            (error.response?.data?.message || error.message),
                          "error"
                        );
                      }
                    }}
                  >
                    Unlock Submission
                  </Button>
                </div>
              )}

                <div className="mt-4 flex flex-wrap gap-2.5 border-t border-line pt-4">
                  <Button
                    variant="primary"
                    onClick={() => handleReviewSubmission(false)}
                    disabled={selectedSubmission.status === "locked"}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="dangerGhost"
                    onClick={() => handleReviewSubmission(true)}
                    disabled={selectedSubmission.status === "locked"}
                  >
                    Flag for Review
                  </Button>
                </div>
              </div>
            </details>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
};

export default ExamSubmissions;
