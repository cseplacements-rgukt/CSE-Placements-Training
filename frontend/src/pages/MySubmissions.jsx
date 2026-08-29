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
    <div className="mt-5 grid grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
    <Skeleton className="mt-5 h-9 w-24" />
  </div>
);

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
        <PageHeader title="My Submissions" subtitle="Review your past exam answers and performance breakdown" />
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="My Submissions"
        subtitle="Review your past exam answers and performance breakdown"
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

              return (
                <div key={submission._id} className="flex flex-col rounded-md border border-line bg-surface p-5 shadow-sm transition-shadow duration-150 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-semibold leading-snug text-ink">
                        {submission.examId?.title || "Exam"}
                      </h2>
                      {submission.examId?.description && (
                        <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                          {submission.examId.description.length > 45
                            ? submission.examId.description.substring(0, 45) + "..."
                            : submission.examId.description}
                        </p>
                      )}
                    </div>
                    <Badge dot variant={statusCfg.variant}>{statusCfg.label}</Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-4">
                    {submission.resultsPending ? (
                      <p className="col-span-4 text-[13px] text-ink-muted">
                        Results will be available{" "}
                        <strong className="text-ink">
                          {submission.resultsReleaseAt
                            ? new Date(submission.resultsReleaseAt).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "after the exam ends"}
                        </strong>{" "}
                        — after the exam window closes for everyone.
                      </p>
                    ) : (
                      <p className="col-span-4 text-[13px] text-ink-muted">
                        Submitted successfully{submission.submittedAt ? ` on ${new Date(submission.submittedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ""} — awaiting review. Score will appear only if admin overrides.
                      </p>
                    )}
                    <div>
                      <p className="text-lg font-bold tabular-nums text-ink">{submission.answers?.length || 0}</p>
                      <p className="text-xs text-ink-muted">Q's</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold tabular-nums text-ink">
                        {submission.submittedAt
                          ? new Date(submission.submittedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
                          : "—"}
                      </p>
                      <p className="text-xs text-ink-muted">Date</p>
                    </div>
                  </div>

                  <div className="mt-auto pt-4">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleViewDetails(submission)}
                      disabled={detailLoading === submission._id}
                    >
                      {detailLoading === submission._id ? "Loading…" : "View Details"}
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
            <span className="flex items-center gap-2.5">
              <Badge dot variant={getStatusConfig(selectedSubmission.status).variant}>
                {getStatusConfig(selectedSubmission.status).label}
              </Badge>
              {selectedSubmission.resultsPending ? (
                <span className="text-sm font-medium text-ink-muted">
                  Results pending — released after the exam window closes
                </span>
              ) : (
                <span className="text-sm font-medium text-ink-muted">
                  Submitted — score visible only after admin override
                </span>
              )}
            </span>
          )
        }
      >
        {selectedSubmission && (
            <div className="space-y-4">
              {selectedSubmission.resultsPending && (
                <Alert variant="info">
                  Results are withheld until the exam window closes for everyone
                  {selectedSubmission.resultsReleaseAt
                    ? ` (available ${new Date(selectedSubmission.resultsReleaseAt).toLocaleString()})`
                    : ""}
                  .
                </Alert>
              )}
              {!canShowCorrectAnswer(selectedSubmission) && (
                <Alert variant="info">
                  Your coordinator has not released the right answers yet.
                </Alert>
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
                const showCorrect = canShowCorrectAnswer(selectedSubmission);

                const renderQuestionCard = (question, index) => {
                  const answer = selectedSubmission.answers?.find(
                    (a) => String(a.questionId) === String(question._id)
                  );
                  const isCorrect = answer?.isCorrect || (answer?.marksAwarded > 0);
                  const awarded = answer?.marksAwarded || 0;

                  return (
                    <div
                      key={question._id || index}
                      className={`rounded-md border p-4 ${
                        showCorrect
                          ? isCorrect
                            ? "border-green-200 bg-green-50/40"
                            : "border-red-200 bg-red-50/30"
                          : "border-line"
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
                        <div className="rounded-sm border border-line bg-surface p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Your Answer</p>
                          <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${
                            showCorrect ? (isCorrect ? "text-success" : "text-danger") : "text-ink"
                          }`}>
                            {answer?.answer || "(No answer provided)"}
                          </p>
                        </div>
                        {showCorrect && (
                          <div className="rounded-sm border border-line bg-surface p-3">
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
                        <div className="mt-3 rounded-sm bg-canvas px-3 py-2 text-[13px] leading-relaxed text-stone-600">
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
                <div className="mt-2 rounded-sm bg-canvas px-3 py-2">
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
