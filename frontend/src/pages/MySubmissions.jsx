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

const CardSkeleton = () => (
  <div className="rounded-md border border-line bg-surface p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-5 w-20 rounded-full" />
    </div>
    <div className="mt-5 grid grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-md" />
      ))}
    </div>
    <Skeleton className="mt-4 h-9 w-24" />
  </div>
);

const ScoreSummary = ({ submission }) => {
  const score = submission.score ?? 0;
  const maxScore = submission.maxScore ?? 0;
  const percentage = Math.round(submission.percentage ?? 0);
  const percentile = submission.percentile;
  const rank = submission.rank;
  const total = submission.totalParticipants;
  const hasPercentile = typeof percentile === "number" && !isNaN(percentile);
  const passingScore = submission.examId?.settings?.passingScore ?? 50;
  const passed = percentage >= passingScore;

  return (
    <div className="rounded-md border border-line bg-canvas">
      <div className="grid grid-cols-3 divide-x divide-line">
        <div className="px-3 py-3 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Score</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {score} <span className="text-sm font-normal text-ink-muted">/ {maxScore}</span>
          </p>
          <p className="mt-1 text-xs text-ink-muted">{percentage}%</p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Percentage</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{percentage}%</p>
          <div className="mx-auto mt-2 h-1.5 w-20 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-ink" style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} />
          </div>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Percentile</p>
          {hasPercentile ? (
            <>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{percentile}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Rank {rank} of {total}
              </p>
            </>
          ) : total === 1 ? (
            <>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">100</p>
              <p className="mt-1 text-xs text-ink-muted">Only participant</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">—</p>
              <p className="mt-1 text-xs text-ink-muted">No rank yet</p>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${passed ? "text-ink" : "text-ink-muted"}`}>
          <span className={`h-2 w-2 rounded-full ${passed ? "bg-ink" : "bg-stone-400"}`} />
          {passed ? "Passed" : "Not passed"} <span className="text-ink-muted">· Pass {passingScore}%</span>
        </span>
        <span className="text-xs text-ink-muted">
          {submission.answers?.length ?? 0} Q · {submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—"}
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
      setSubmissions(data.submissions || []);
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
        <PageHeader title="My Results" subtitle="Scores, percentage and percentile after the exam window closes" />
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
        subtitle="Scores, percentage and percentile after the exam window closes"
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

              return (
                <div key={submission._id} className="flex flex-col rounded-md border border-line bg-surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[14px] font-semibold text-ink">
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
                      <div className="rounded-md border border-line bg-canvas px-3 py-3">
                        <p className="text-[13px] font-medium text-ink">Results pending</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                          Will be available{" "}
                          <span className="font-medium text-ink">
                            {submission.resultsReleaseAt
                              ? new Date(submission.resultsReleaseAt).toLocaleString([], {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "after the exam ends"}
                          </span>
                          {" "}— after the window closes for everyone.
                        </p>
                        <p className="mt-2 text-xs text-ink-muted">
                          {submission.answers?.length || 0} questions · Submitted {submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"}
                        </p>
                      </div>
                    ) : (
                      <ScoreSummary submission={submission} />
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                    <span className="text-xs text-ink-muted">
                      {submission.submittedAt ? `Submitted ${new Date(submission.submittedAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleViewDetails(submission)}
                      disabled={detailLoading === submission._id}
                    >
                      {detailLoading === submission._id ? "Loading…" : "View details"}
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
            <span className="flex flex-wrap items-center gap-2">
              <Badge dot variant={getStatusConfig(selectedSubmission.status).variant}>
                {getStatusConfig(selectedSubmission.status).label}
              </Badge>
              {selectedSubmission.resultsPending ? (
                <span className="text-sm text-ink-muted">
                  Results pending — {selectedSubmission.resultsReleaseAt ? new Date(selectedSubmission.resultsReleaseAt).toLocaleString() : "after window closes"}
                </span>
              ) : (
                <span className="text-sm text-ink-muted">
                  {Math.round(selectedSubmission.percentage ?? 0)}% · {selectedSubmission.score}/{selectedSubmission.maxScore}
                  {typeof selectedSubmission.percentile === "number" ? ` · Percentile ${selectedSubmission.percentile}` : ""}
                  {selectedSubmission.rank ? ` · Rank ${selectedSubmission.rank}${selectedSubmission.totalParticipants ? `/${selectedSubmission.totalParticipants}` : ""}` : ""}
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
                  Correct answers are hidden by your coordinator.
                </Alert>
              )}

              {/* Result summary — simple, no rainbow */}
              {!selectedSubmission.resultsPending && (
                <div className="rounded-md border border-line bg-surface p-4">
                  <h3 className="text-sm font-semibold text-ink">Result</h3>
                  <div className="mt-3">
                    <ScoreSummary submission={selectedSubmission} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-muted">Score</dt>
                      <dd className="mt-1 font-medium tabular-nums text-ink">{selectedSubmission.score} / {selectedSubmission.maxScore}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-muted">Percentage</dt>
                      <dd className="mt-1 font-medium tabular-nums text-ink">{Math.round(selectedSubmission.percentage ?? 0)}%</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-muted">Percentile</dt>
                      <dd className="mt-1 font-medium tabular-nums text-ink">{typeof selectedSubmission.percentile === "number" ? selectedSubmission.percentile : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-muted">Rank</dt>
                      <dd className="mt-1 font-medium tabular-nums text-ink">{selectedSubmission.rank ? `${selectedSubmission.rank}${selectedSubmission.totalParticipants ? ` / ${selectedSubmission.totalParticipants}` : ""}` : "—"}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-ink-muted">
                    Submitted {selectedSubmission.submittedAt ? new Date(selectedSubmission.submittedAt).toLocaleString() : "—"}
                    {selectedSubmission.reviewedBy ? ` · Reviewed by ${selectedSubmission.reviewedBy?.name || "Coordinator"}` : ""}
                  </p>
                </div>
              )}

              {selectedSubmission.resultsPending && (
                <div className="rounded-md border border-line bg-canvas px-4 py-3 text-sm text-ink-muted">
                  You answered {selectedSubmission.answers?.length || 0} questions. Score, percentage and percentile will appear here after the window closes.
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
                      className="rounded-md border border-line bg-surface p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-canvas text-xs font-medium text-ink">
                            {index + 1}
                          </span>
                          <span className="truncate text-xs uppercase tracking-wide text-ink-muted">
                            {question.type?.replace(/_/g, " ")}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs font-medium tabular-nums text-ink-muted">
                          {showCorrect ? `${awarded} / ${question.points} pts` : `${question.points} pts`}
                        </span>
                      </div>

                      <p className="mt-2.5 text-sm leading-relaxed text-ink">{question.question}</p>

                      <div className={`mt-3 grid gap-3 ${showCorrect ? "sm:grid-cols-2" : ""}`}>
                        <div className="rounded-md border border-line bg-canvas p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Your answer</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
                            {answer?.answer || "(No answer provided)"}
                          </p>
                        </div>
                        {showCorrect && (
                          <div className="rounded-md border border-line bg-canvas p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Correct answer</p>
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
                              {answer.gradingStatus === "graded" ? "Reviewed" : "Pending review"}
                            </Badge>
                          )}
                          {answer.gradingMethod === "exact_match" && (
                            <Badge variant="neutral">Auto-graded</Badge>
                          )}
                        </div>
                      )}

                      {showCorrect && question.explanation && (
                        <div className="mt-3 rounded-md bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink-muted">
                          <strong className="font-medium text-ink">Explanation:</strong>{" "}
                          {question.explanation}
                        </div>
                      )}
                    </div>
                  );
                };

                if (groups.length === 0) {
                  return (
                    <div className="space-y-4">
                      {questions.map(renderQuestionCard)}
                    </div>
                  );
                }

                return groups.map((group) => (
                  <section key={group.key}>
                    <div className="flex items-center justify-between gap-3 border-b border-line pb-1.5">
                      <h4 className="truncate text-[13px] font-semibold text-ink">
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
                <strong className="font-medium text-ink">Submitted on:</strong>{" "}
                {selectedSubmission.submittedAt
                  ? new Date(selectedSubmission.submittedAt).toLocaleString()
                  : "Not submitted"}
              </p>
              {selectedSubmission.reviewedBy && (
                <p className="mt-1">
                  <strong className="font-medium text-ink">Reviewed by:</strong>{" "}
                  {selectedSubmission.reviewedBy?.name || "Coordinator"}
                </p>
              )}
              {selectedSubmission.reviewNotes && (
                <div className="mt-2 rounded-md bg-canvas px-3 py-2">
                  <strong className="font-medium text-ink">Reviewer notes:</strong>
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
