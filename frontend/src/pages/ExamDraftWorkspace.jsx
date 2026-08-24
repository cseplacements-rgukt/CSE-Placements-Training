import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { examService } from "../services/examService";
import { uploadService } from "../services/uploadService";
import { RichContent, RichInline, QuestionBody } from "../components/RichContent";
import ExamQuestionsJsonImport from "../components/ExamQuestionsJsonImport";
import AppLayout from "../components/AppLayout";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";
import Card, { CardBody, CardHeader, CardTitle, CardFooter } from "../components/ui/Card";
import { LoadingScreen } from "../components/ui/Spinner";
import { Input, Select, Textarea, FileInput } from "../components/ui/Input";
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];
const CODE_LANGUAGES = ["javascript", "python", "java", "c", "cpp", "sql", "json", "plaintext"];
const DIFFICULTY_BUCKETS = ["Easy", "Medium", "Hard"];

const emptyQuestion = () => ({
  type: "mcq",
  contentType: "text",
  codeSnippet: { code: "", language: "javascript" },
  question: "",
  options: ["", "", "", ""],
  correctAnswer: "",
  modelAnswer: "",
  points: 1,
  imageUrl: "",
  explanation: "",
  constraints: { wordLimit: null, difficultyLevel: "medium" },
});

const STATUS_META = {
  draft: { label: "Draft", variant: "neutral" },
  ready_for_review: { label: "Ready for Review", variant: "info" },
  published: { label: "Published", variant: "success" },
  closed: { label: "Closed", variant: "neutral" },
  archived: { label: "Archived", variant: "neutral" },
};

const DIFFICULTY_VARIANT = {
  easy: "success",
  medium: "warning",
  hard: "danger",
};

const TAB_BASE =
  "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const TAB_ACTIVE = "border-primary text-ink";
const TAB_IDLE = "border-transparent text-ink-muted hover:border-stone-300 hover:text-ink";

/* ═══════════════════════════════════════════════════════════════════════════
   Question Editor — shared by "add" and "edit" flows.
   ═══════════════════════════════════════════════════════════════════════════ */
const QuestionEditor = ({ initial, onSave, onCancel, saving, sections, uploadImage }) => {
  const [q, setQ] = useState({ ...emptyQuestion(), ...initial });
  const [showPreview, setShowPreview] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(initial?.imageUrl || "");
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(null);

  const update = (field, value) => {
    if (field === "question") setDuplicate(null);
    setQ((prev) => ({ ...prev, [field]: value }));
  };

  const changeType = (type) => {
    setQ((prev) => {
      const next = { ...prev, type };
      if (type === "mcq") {
        if (!next.options || next.options.length === 0) next.options = ["", "", "", ""];
        else if (next.type !== "mcq") next.correctAnswer = "";
      } else if (type === "true_false") {
        next.options = ["True", "False"];
        next.correctAnswer = "";
      } else {
        next.options = [];
        next.correctAnswer = "";
      }
      return next;
    });
  };

  // Difficulty buckets: when the parent opens this editor inside a section
  // named Easy/Medium/Hard it pre-sets the matching default difficulty, so
  // "one member owns Medium" just works — no state sync needed here.

  const isOptionType = q.type === "mcq" || q.type === "true_false";

  const validate = () => {
    if (!q.question.trim()) return "Question text is required.";
    if (!q.correctAnswer) return "Mark the correct answer.";
    if (isOptionType) {
      const filled = q.options.filter((o) => o.trim());
      if (filled.length < 2) return "At least 2 options are required.";
      if (!filled.includes(q.correctAnswer)) return "Correct answer must match an option.";
    }
    if (q.contentType === "code" && !q.codeSnippet.code.trim()) {
      return "Paste the code snippet for code questions.";
    }
    return null;
  };

  const submit = async (extra = {}) => {
    const err = validate();
    if (err) {
      setError(err);
      return false;
    }
    setError("");
    try {
      let finalImageUrl = q.imageUrl;
      if (imageFile) {
        finalImageUrl = await uploadImage(imageFile);
      }
      await onSave({
        ...q,
        imageUrl: finalImageUrl,
        options: isOptionType ? q.options.filter((o) => o.trim()) : [],
        codeSnippet: q.contentType === "code" ? q.codeSnippet : { code: "", language: "plaintext" },
        ...extra,
      });
      setDuplicate(null);
      return true;
    } catch (e) {
      if (e.response?.status === 409 && e.response?.data?.conflict) {
        setError("");
        setDuplicate(e.response.data.conflict);
        return false;
      }
      setError(e.response?.data?.message || e.message || "Failed to save question.");
      return false;
    }
  };

  const handleSave = () => submit();
  const handleReplaceDuplicate = () => submit({ replaceExisting: true });

  const handleImageSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Image size must be less than 5MB.");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setError("");
  };

  const toggleBtn =
    "flex h-9 flex-1 items-center justify-center rounded-sm px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

  return (
    <Card className="mb-5 border-accent/40">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{initial?._id ? "Edit Question" : "New Question"}</CardTitle>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </CardHeader>
      <CardBody className="space-y-4 pt-0">
        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <span className="mb-1.5 block text-sm font-medium text-ink">Content Type</span>
            <div className="flex gap-1 rounded-sm bg-primary-light p-1">
              <button
                type="button"
                className={`${toggleBtn} ${q.contentType === "text" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                onClick={() => update("contentType", "text")}
              >
                Text / Math
              </button>
              <button
                type="button"
                className={`${toggleBtn} ${q.contentType === "code" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                onClick={() => update("contentType", "code")}
              >
                Code Snippet
              </button>
            </div>
          </div>
          <Select
            label="Type"
            value={q.type}
            onChange={(e) => changeType(e.target.value)}
            className="sm:w-44"
          >
            <option value="mcq">Multiple Choice</option>
            <option value="true_false">True / False</option>
            <option value="short_answer">Short Answer</option>
            <option value="fill_blank">Fill in the Blank</option>
            <option value="essay">Essay</option>
          </Select>
          <Input
            label="Marks"
            type="number"
            value={q.points}
            onChange={(e) => update("points", parseInt(e.target.value) || 1)}
            min="1"
            className="sm:w-24"
          />
          <Select
            label="Difficulty"
            value={q.constraints?.difficultyLevel || "medium"}
            onChange={(e) =>
              setQ((prev) => ({ ...prev, constraints: { ...prev.constraints, difficultyLevel: e.target.value } }))
            }
            className="sm:w-36"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
        </div>

        {q.contentType === "code" && (
          <div className="rounded-md bg-canvas p-4">
            <Select
              label="Language"
              value={q.codeSnippet.language}
              onChange={(e) => setQ((prev) => ({ ...prev, codeSnippet: { ...prev.codeSnippet, language: e.target.value } }))}
              className="max-w-48"
            >
              {CODE_LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
            <div className="mt-3">
              <label className="mb-1.5 block text-sm font-medium text-ink">Code *</label>
              <textarea
                rows={7}
                spellCheck={false}
                placeholder="Paste the code snippet here…"
                value={q.codeSnippet.code}
                onChange={(e) => setQ((prev) => ({ ...prev, codeSnippet: { ...prev.codeSnippet, code: e.target.value } }))}
                className="w-full rounded-sm border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
            </div>
          </div>
        )}

        <div>
          <Textarea
            label="Question Text *"
            value={q.question}
            onChange={(e) => update("question", e.target.value)}
            placeholder={
              q.contentType === "code"
                ? "e.g. What does this function return?"
                : "Use $x^2$ for math and ```lang … ``` fences for code blocks."
            }
            rows={3}
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <small className="text-xs text-ink-muted">
              Math: <code className="rounded-sm bg-primary-light px-1 py-0.5">$x^2$</code> or{" "}
              <code className="rounded-sm bg-primary-light px-1 py-0.5">{"$$\\frac{a}{b}$$"}</code> · Inline code:{" "}
              <code className="rounded-sm bg-primary-light px-1 py-0.5">`sum()`</code>
            </small>
            <Button size="sm" variant="secondary" onClick={() => setShowPreview((p) => !p)}>
              {showPreview ? "Hide Preview" : "Live Preview"}
            </Button>
          </div>
          {showPreview && (
            <div className="mt-2 rounded-md border border-line bg-canvas p-4 [&_p]:!mb-1">
              {q.contentType === "code" && q.codeSnippet.code && (
                <RichContent text={"```" + q.codeSnippet.language + "\n" + q.codeSnippet.code + "\n```"} />
              )}
              <RichContent text={q.question} />
            </div>
          )}
        </div>

        {isOptionType && (
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-ink">
              Options * — select the radio of the correct bit
            </legend>
            <div className="space-y-2">
              {q.options.map((opt, i) => {
                const isCorrect = !!opt.trim() && q.correctAnswer === opt;
                return (
                  <div key={i} className={`flex items-center gap-2.5 ${isCorrect ? "" : ""}`}>
                    <input
                      type="radio"
                      name="ws-correct-option"
                      checked={isCorrect}
                      onChange={() => update("correctAnswer", opt)}
                      title="Mark as correct"
                      disabled={!opt.trim()}
                      aria-label={`Mark option ${OPTION_LETTERS[i]} as correct`}
                      className="h-4 w-4 shrink-0 accent-[#b45309]"
                    />
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-xs font-semibold ${
                        isCorrect ? "bg-accent-light text-accent-dark" : "bg-primary-light text-ink-muted"
                      }`}
                    >
                      {OPTION_LETTERS[i]}
                    </span>
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const opts = [...q.options];
                        const wasCorrect = q.correctAnswer === opts[i];
                        opts[i] = e.target.value;
                        setQ((prev) => ({
                          ...prev,
                          options: opts,
                          correctAnswer: wasCorrect ? e.target.value : prev.correctAnswer,
                        }));
                      }}
                      placeholder={`Option ${OPTION_LETTERS[i]}`}
                      disabled={q.type === "true_false"}
                      className={`h-9 w-full rounded-sm border bg-surface px-3 text-sm text-ink transition-colors placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-accent/25 ${
                        isCorrect ? "border-accent" : "border-line focus:border-accent"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            {q.type === "mcq" && q.options.length < 6 && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2.5"
                onClick={() => setQ((prev) => ({ ...prev, options: [...prev.options, ""] }))}
              >
                + Add Option
              </Button>
            )}
            {q.options.filter((o) => o.trim()).length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {q.options.filter((o) => o.trim()).map((o, i) => (
                  <span key={i} className="inline-flex items-center rounded-full bg-canvas px-2.5 py-1 text-xs text-stone-600 ring-1 ring-inset ring-line">
                    <RichInline text={o} />
                  </span>
                ))}
              </div>
            )}
          </fieldset>
        )}

        {!isOptionType && (
          <Input
            label="Correct Answer *"
            type="text"
            value={q.correctAnswer}
            onChange={(e) => update("correctAnswer", e.target.value)}
            placeholder="Exact expected answer"
          />
        )}

        {(q.type === "short_answer" || q.type === "fill_blank" || q.type === "essay") && (
          <Textarea
            label="Model Answer (Review Reference)"
            value={q.modelAnswer}
            onChange={(e) => update("modelAnswer", e.target.value)}
            placeholder="Reference answer for coordinators reviewing this question"
            rows={2}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr] sm:items-start">
          <Select
            label="Section"
            value={q.sectionId || ""}
            onChange={(e) => update("sectionId", e.target.value || null)}
          >
            <option value="">Ungrouped (flat pool)</option>
            {sections.map((s) => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </Select>
          <Input
            label="Word Limit (optional)"
            type="number"
            min="0"
            value={q.constraints?.wordLimit ?? ""}
            onChange={(e) =>
              setQ((prev) => ({
                ...prev,
                constraints: { ...prev.constraints, wordLimit: e.target.value ? parseInt(e.target.value) : null },
              }))
            }
            placeholder="None"
          />
          <FileInput
            label="Image (optional)"
            accept="image/jpeg, image/png, image/webp"
            onChange={handleImageSelect}
          />
          {imagePreview && (
            <div className="flex items-center gap-2.5 sm:col-span-3">
              <img src={imagePreview} alt="Preview" width={60} height={45} className="h-[45px] w-auto rounded-sm border border-line object-cover" />
              <Button
                size="sm"
                variant="dangerGhost"
                onClick={() => { setImageFile(null); setImagePreview(""); update("imageUrl", ""); }}
              >
                Remove
              </Button>
            </div>
          )}
        </div>

        {duplicate && (
          <Alert variant="warning" title="Duplicate question detected">
            <p>
              A question with this exact text already exists{" "}
              {duplicate.inExam ? "in this exam" : "in the question bank"}
              {duplicate.createdAt
                ? ` (added ${new Date(duplicate.createdAt).toLocaleDateString()})`
                : ""}. Replace it with what you typed, or keep the existing one?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={handleReplaceDuplicate} disabled={saving}>
                {saving ? "Replacing…" : "Replace Existing Question"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDuplicate(null)}>
                Keep Existing (Don't Add)
              </Button>
            </div>
          </Alert>
        )}

        <div className="pt-1">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : initial?._id ? "Save Changes" : "Add to Exam"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   Exam Draft Workspace
   ═══════════════════════════════════════════════════════════════════════════ */
const ExamDraftWorkspace = () => {
  const { examId } = useParams();
  const { userProfile, getAuthToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState(searchParams.get("tab") === "review" ? "review" : "build");

  // Metadata form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [examCategory, setExamCategory] = useState("Aptitude");
  const [settings, setSettings] = useState({});
  const [metaDirty, setMetaDirty] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  // Sections rail
  const [selectedSection, setSelectedSection] = useState("all"); // all | ungrouped | sectionId
  const [newSectionName, setNewSectionName] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [renamingSectionId, setRenamingSectionId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Question editor
  const [showAddForm, setShowAddForm] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [savingQuestion, setSavingQuestion] = useState(false);

  // Team tab
  const [collaborators, setCollaborators] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  // Review tab
  const [review, setReview] = useState(null);
  const [publishAt, setPublishAt] = useState("");
  const [publishDuration, setPublishDuration] = useState(60);
  const [publishing, setPublishing] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [flash, setFlash] = useState(null); // {kind:'success'|'error', text}

  const editingLocallyRef = useRef(false);
  editingLocallyRef.current = !!editingQuestion;
  // True while any exam-details field has focus — blocks background syncs
  // from resetting the form mid-typing.
  const metaEditingRef = useRef(false);
  const metaFocusHandlers = {
    onFocus: () => { metaEditingRef.current = true; },
    onBlur: () => { metaEditingRef.current = false; },
  };

  const myRoleEntry = exam?.collaborators?.find(
    (c) => c.userId && (c.userId === userProfile?._id || c.userId?._id === userProfile?._id)
  );
  const isCreator =
    !!userProfile &&
    (exam?.teacherId === userProfile._id ||
      exam?.teacherId?._id === userProfile._id ||
      myRoleEntry?.role === "creator");
  const isAdminRole = userProfile?.role === "admin";
  const isEditable = exam ? ["draft", "ready_for_review"].includes(exam.status) : false;
  const canManage = isCreator || isAdminRole;

  const flashMsg = (kind, text) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(null), 4000);
  };

  // ── Data loading ───────────────────────────────────────────────────────────
  const applyExam = (data, { includeMeta = true } = {}) => {
    setExam(data.exam);
    // While the teacher is editing exam details, background syncs must not
    // clobber the form (typing loss + jank). Meta fields are only refreshed
    // on initial load or when nothing is being edited.
    if (includeMeta) {
      setTitle(data.exam.title || "");
      setDescription(data.exam.description || "");
      setExamCategory(data.exam.examCategory || "Aptitude");
      setSettings({
        requireWebcam: true,
        requireFullscreen: true,
        shuffleQuestions: false,
        shuffleOptions: false,
        allowBackNavigation: true,
        showResultsImmediately: true,
        autoSubmitOnTimeUp: true,
        maxAttempts: 1,
        passingScore: 50,
        ...(data.exam.settings || {}),
      });
    }
  };

  const fetchExam = useCallback(async ({ includeMeta = true } = {}) => {
    try {
      const token = await getAuthToken();
      const data = await examService.getExam(token, examId);
      applyExam(data, { includeMeta });
      return data.exam;
    } catch (err) {
      setError(err.response?.data?.message || "Error loading exam");
      throw err;
    }
  }, [examId, getAuthToken]);

  const fetchTeam = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const data = await examService.getCollaborators(token, examId);
      setCollaborators(data.collaborators || []);
    } catch (err) {
      console.error("Error loading collaborators:", err);
    }
  }, [examId, getAuthToken]);

  const fetchReview = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const data = await examService.getConsolidatedReview(token, examId);
      setReview(data);
    } catch (err) {
      console.error("Error loading review:", err);
    }
  }, [examId, getAuthToken]);

  useEffect(() => {
    fetchExam()
      .catch(() => {})
      .finally(() => setLoading(false));
    fetchTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Live collaboration awareness: poll while nobody is mid-edit locally.
  useEffect(() => {
    const interval = setInterval(() => {
      // Skip entirely while exam details are being edited (or have unsaved
      // edits): the poll must never overwrite in-progress typing, and
      // skipping also avoids a full-tree re-render every 12 s while on the
      // Details tab (the source of the "save draft lag").
      if (
        document.hidden ||
        editingLocallyRef.current ||
        metaEditingRef.current ||
        metaDirty ||
        savingQuestion ||
        savingMeta
      ) return;
      fetchExam({ includeMeta: false }).catch(() => {});
      if (tab === "team") fetchTeam();
      if (tab === "review") fetchReview();
    }, 12000);
    return () => clearInterval(interval);
    // Deps intentionally narrow: re-subscribing on saving-state churn would
    // keep resetting the poll interval during edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchExam, tab]);

  useEffect(() => {
    if (tab === "review") fetchReview();
    if (tab === "team") fetchTeam();
  }, [tab, fetchReview, fetchTeam]);

  const switchTab = (t) => {
    setTab(t);
    setSearchParams(t === "review" ? { tab: "review" } : {});
  };

  // ── Metadata ───────────────────────────────────────────────────────────────
  const markMetaDirty = () => setMetaDirty(true);

  const handleSaveMeta = async () => {
    if (!title.trim()) {
      flashMsg("error", "Title cannot be empty.");
      return;
    }
    try {
      setSavingMeta(true);
      const token = await getAuthToken();
      const res = await examService.updateExam(token, examId, {
        title: title.trim(),
        description,
        examCategory,
        settings,
      });
      applyExam(res);
      setMetaDirty(false);
      flashMsg("success", "Exam details saved.");
    } catch (err) {
      flashMsg("error", err.response?.data?.message || "Failed to save details.");
    } finally {
      setSavingMeta(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setMetaDirty(true);
  };

  // ── Sections ───────────────────────────────────────────────────────────────
  const handleAddSection = async (presetName) => {
    const name = (presetName || newSectionName).trim();
    if (!name) return;
    try {
      setAddingSection(true);
      const token = await getAuthToken();
      const res = await examService.addSection(token, examId, name);
      setExam(res.exam);
      setNewSectionName("");
    } catch (err) {
      flashMsg("error", err.response?.data?.message || "Failed to create section.");
    } finally {
      setAddingSection(false);
    }
  };

  const handleRenameSection = async (sectionId) => {
    if (!renameValue.trim()) return;
    try {
      const token = await getAuthToken();
      const res = await examService.renameSection(token, examId, sectionId, renameValue.trim());
      setExam(res.exam);
      setRenamingSectionId(null);
    } catch (err) {
      flashMsg("error", err.response?.data?.message || "Failed to rename section.");
    }
  };

  const handleDeleteSection = async (section) => {
    if (!window.confirm(`Delete section "${section.name}"? Its questions move back to the ungrouped pool.`)) return;
    try {
      const token = await getAuthToken();
      const res = await examService.deleteSection(token, examId, section._id);
      setExam(res.exam);
      setSelectedSection("all");
    } catch (err) {
      flashMsg("error", err.response?.data?.message || "Failed to delete section.");
    }
  };

  // ── Questions ──────────────────────────────────────────────────────────────
  const uploadImage = async (file) => {
    const token = await getAuthToken();
    return uploadService.uploadImage(token, file);
  };

  // Fresh question pre-filled for the section currently open on the rail.
  const newQuestionInitial = () => {
    const base = emptyQuestion();
    if (selectedSection !== "all" && selectedSection !== "ungrouped") {
      base.sectionId = selectedSection;
      const sec = sections.find((s) => s._id === selectedSection);
      if (sec && DIFFICULTY_BUCKETS.some((b) => b.toLowerCase() === sec.name.toLowerCase())) {
        base.constraints.difficultyLevel = sec.name.toLowerCase();
      }
    }
    return base;
  };

  const handleAddQuestion = async (payload) => {
    setSavingQuestion(true);
    try {
      const token = await getAuthToken();
      const res = await examService.addExamQuestion(token, examId, payload);
      setExam(res.exam);
      setShowAddForm(false);
      flashMsg("success", res.replaced ? "Existing question replaced." : "Question added.");
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleUpdateQuestion = async (payload) => {
    setSavingQuestion(true);
    try {
      const token = await getAuthToken();
      const res = await examService.updateExamQuestion(token, examId, editingQuestion._id, payload);
      setExam(res.exam);
      setEditingQuestion(null);
      flashMsg("success", "Question updated.");
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleRemoveQuestion = async (question) => {
    if (!window.confirm("Remove this question from the exam?")) return;
    try {
      const token = await getAuthToken();
      const res = await examService.removeExamQuestion(token, examId, question._id);
      setExam(res.exam);
    } catch (err) {
      alert(err.response?.data?.message || "Failed to remove question.");
    }
  };

  // ── Bulk import from JSON file ─────────────────────────────────────────────
  const handleJsonImport = async (importedQuestions) => {
    setShowJsonImport(false);
    let added = 0;
    let failed = 0;
    for (const payload of importedQuestions) {
      try {
        const token = await getAuthToken();
        const res = await examService.addExamQuestion(token, examId, payload);
        setExam(res.exam);
        added++;
      } catch (err) {
        failed++;
        console.error("Failed to add imported question:", err.response?.data?.message);
      }
    }
    if (added > 0 && failed === 0) {
      flashMsg("success", `Added ${added} question${added !== 1 ? "s" : ""} from JSON.`);
    } else if (added > 0) {
      flashMsg("error", `Added ${added}, but ${failed} question${failed !== 1 ? "s" : ""} were rejected by the server.`);
    } else {
      flashMsg("error", "None of the questions could be added — check the server requirements.");
    }
  };

  // ── Team ───────────────────────────────────────────────────────────────────
  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      setInviting(true);
      const token = await getAuthToken();
      const res = await examService.addCollaborator(token, examId, inviteEmail.trim());
      setExam(res.exam);
      setInviteEmail("");
      await fetchTeam();
      flashMsg("success", res.message || "Collaborator added.");
    } catch (err) {
      flashMsg("error", err.response?.data?.message || "Failed to add collaborator.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (member) => {
    if (!window.confirm(`Remove ${member.name} from this exam's team?`)) return;
    try {
      const token = await getAuthToken();
      await examService.removeCollaborator(token, examId, member.userId);
      await Promise.all([fetchTeam(), fetchExam()]);
    } catch (err) {
      flashMsg("error", err.response?.data?.message || "Failed to remove collaborator.");
    }
  };

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const handleSetStatus = async (status) => {
    try {
      setStatusBusy(true);
      const token = await getAuthToken();
      const res = await examService.setExamStatus(token, examId, status);
      setExam(res.exam);
      flashMsg("success", res.message);
    } catch (err) {
      flashMsg("error", err.response?.data?.message || "Failed to update status.");
    } finally {
      setStatusBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!publishAt || !publishDuration || publishDuration <= 0) {
      flashMsg("error", "Set the exam date/time and duration to publish.");
      return;
    }
    const when = new Date(publishAt);
    if (when.getTime() + publishDuration * 60000 <= Date.now()) {
      flashMsg("error", "The exam window would already be over. Pick a future date/time.");
      return;
    }
    try {
      setPublishing(true);
      const token = await getAuthToken();
      const res = await examService.publishExam(token, examId, {
        scheduledAt: when.toISOString(),
        duration: Number(publishDuration),
      });
      setExam(res.exam);
      flashMsg("success", `Published! Share this exam code with students: ${res.exam.examCode}`);
      fetchReview();
    } catch (err) {
      const errs = err.response?.data?.errors;
      flashMsg("error", errs ? errs.join(" ") : err.response?.data?.message || "Publish failed.");
    } finally {
      setPublishing(false);
    }
  };

  // ── Derived views ──────────────────────────────────────────────────────────
  if (loading || !userProfile) return <LoadingScreen message="Loading workspace…" />;

  if (error && !exam) {
    return (
      <AppLayout>
        <div className="mx-auto mt-10 max-w-lg rounded-md border border-line bg-surface shadow-sm">
          <EmptyState
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            }
            title="Cannot open this draft"
            description={error}
            action={<Link to="/dashboard"><Button variant="secondary">Back to Dashboard</Button></Link>}
          />
        </div>
      </AppLayout>
    );
  }

  if (!exam) return null;

  const questions = exam.questions || [];
  const sections = exam.sections || [];
  const statusMeta = STATUS_META[exam.status] || STATUS_META.draft;

  const visibleQuestions = questions.filter((q) => {
    if (selectedSection === "all") return true;
    if (selectedSection === "ungrouped") return !q.sectionId;
    return q.sectionId === selectedSection || q.sectionId?.$oid === selectedSection ||
      (q.sectionId && String(q.sectionId) === selectedSection);
  });

  const countFor = (key) =>
    key === "all"
      ? questions.length
      : key === "ungrouped"
        ? questions.filter((q) => !q.sectionId).length
        : questions.filter((q) => String(q.sectionId) === key).length;

  const authorName = (q) => {
    const id = q.createdBy && (q.createdBy._id || q.createdBy);
    const member = collaborators.find((c) => String(c.userId) === String(id));
    return member?.name || q.createdByName || "Teammate";
  };

  const totalPoints = questions.reduce((s, q) => s + (q.points || 1), 0);

  const railItem =
    "flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
  const railIdle = "text-stone-600 hover:bg-primary-light hover:text-ink";
  const railActive = "bg-primary text-white hover:bg-primary";

  return (
    <AppLayout maxWidth="max-w-7xl">
      {/* ── Header ─────────────────────────────────────────────── */}
      <PageHeader
        title={exam.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Link to="/dashboard" className="underline-offset-2 hover:underline">Dashboard</Link>
            <span aria-hidden="true">/</span>
            <span>Draft Workspace</span>
          </span>
        }
        actions={
          <>
            <Badge dot variant={statusMeta.variant}>{statusMeta.label}</Badge>
            <Badge variant="neutral">{questions.length} questions</Badge>
            <Badge variant="neutral">{totalPoints} marks</Badge>
            <Badge variant="neutral">{collaborators.length || exam.collaborators?.length || 1} on team</Badge>
            {exam.examCode && (
              <span className="rounded-sm bg-canvas px-2.5 py-1 font-mono text-[13px] font-semibold tracking-wider text-ink ring-1 ring-inset ring-line">
                Code: {exam.examCode}
              </span>
            )}
          </>
        }
      />

      <div className="mt-5 space-y-5">
        {flash && (
          <Alert variant={flash.kind === "success" ? "success" : "error"}>
            {flash.text}
          </Alert>
        )}
        {!isEditable && (
          <Alert variant="warning">
            {exam.status === "published"
              ? "Published — questions are locked. Use “Unpublish” on the dashboard (while no one has attempted) to reopen editing."
              : "This exam is closed and read-only."}
          </Alert>
        )}

        {/* ── Tabs ───────────────────────────────────────────────── */}
        <div role="tablist" aria-label="Workspace tabs" className="border-b border-line">
          <nav className="-mb-px flex gap-1">
            <button role="tab" aria-selected={tab === "build"} className={`${TAB_BASE} ${tab === "build" ? TAB_ACTIVE : TAB_IDLE}`} onClick={() => switchTab("build")}>
              Build
            </button>
            <button role="tab" aria-selected={tab === "team"} className={`${TAB_BASE} ${tab === "team" ? TAB_ACTIVE : TAB_IDLE}`} onClick={() => switchTab("team")}>
              Team
            </button>
            <button role="tab" aria-selected={tab === "review"} className={`${TAB_BASE} ${tab === "review" ? TAB_ACTIVE : TAB_IDLE}`} onClick={() => switchTab("review")}>
              Review{exam.status === "ready_for_review" ? " ✓" : ""}
            </button>
          </nav>
        </div>

        {/* ═══ BUILD TAB ══════════════════════════════════════════ */}
        {tab === "build" && (
          <>
            {/* Details card */}
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4 pt-0">
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                  <Input
                    label="Title *"
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); markMetaDirty(); }}
                    {...metaFocusHandlers}
                  />
                  <Select
                    label="Round / Category"
                    value={examCategory}
                    onChange={(e) => { setExamCategory(e.target.value); markMetaDirty(); }}
                    disabled={!isEditable}
                    {...metaFocusHandlers}
                  >
                    <option value="Aptitude">Aptitude</option>
                    <option value="Technical">Technical</option>
                    <option value="Coding">Coding</option>
                    <option value="Mixed">Mixed</option>
                  </Select>
                </div>
                <Textarea
                  label="Description"
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); markMetaDirty(); }}
                  rows={2}
                  {...metaFocusHandlers}
                />

                <details className="group rounded-sm border border-line">
                  <summary className="cursor-pointer list-none select-none px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-canvas [&::-webkit-details-marker]:hidden">
                    Proctoring &amp; exam settings
                  </summary>
                  <div className="space-y-4 border-t border-line p-4">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["requireWebcam", "Require Webcam"], ["requireFullscreen", "Require Fullscreen"],
                        ["shuffleQuestions", "Shuffle Questions"], ["shuffleOptions", "Shuffle Options"],
                        ["allowBackNavigation", "Allow Back Navigation"], ["showResultsImmediately", "Show Results Immediately"],
                        ["autoSubmitOnTimeUp", "Auto Submit on Timeout"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={!!settings[key]}
                            onChange={(e) => updateSetting(key, e.target.checked)}
                            className="h-4 w-4 accent-[#b45309]"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="grid max-w-md grid-cols-2 gap-4">
                      <Input
                        label="Passing Score (%)"
                        type="number"
                        min="0"
                        max="100"
                        value={settings.passingScore ?? 50}
                        onChange={(e) => updateSetting("passingScore", parseInt(e.target.value) || 0)}
                      />
                      <Input
                        label="Max Attempts"
                        type="number"
                        min="1"
                        value={settings.maxAttempts ?? 1}
                        onChange={(e) => updateSetting("maxAttempts", parseInt(e.target.value) || 1)}
                      />
                    </div>
                  </div>
                </details>

                <div className="pt-1">
                  <Button onClick={handleSaveMeta} disabled={savingMeta || (!isEditable && !canManage)}>
                    {savingMeta ? "Saving…" : metaDirty ? "Save Details *" : "Save Details"}
                  </Button>
                </div>
              </CardBody>
            </Card>

            {/* Sections rail + question list */}
            <div className="lg:flex lg:items-start lg:gap-6">
              <aside className="mb-5 w-full lg:sticky lg:top-20 lg:mb-0 lg:w-64 lg:shrink-0">
                <div className="rounded-md border border-line bg-surface p-3 shadow-sm">
                  <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                    Sections
                  </h2>
                  <div className="space-y-1">
                    <button className={`${railItem} ${selectedSection === "all" ? railActive : railIdle}`} onClick={() => setSelectedSection("all")}>
                      All Questions <span className="tabular-nums opacity-70">{countFor("all")}</span>
                    </button>
                    <button className={`${railItem} ${selectedSection === "ungrouped" ? railActive : railIdle}`} onClick={() => setSelectedSection("ungrouped")}>
                      Ungrouped <span className="tabular-nums opacity-70">{countFor("ungrouped")}</span>
                    </button>
                    {sections.map((s) => (
                      <div key={s._id} className="relative">
                        {renamingSectionId === s._id ? (
                          <div className="flex items-center gap-1.5 px-1 py-1">
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              autoFocus
                              className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                            />
                            <Button size="sm" className="px-2" onClick={() => handleRenameSection(s._id)}>✓</Button>
                            <Button size="sm" variant="secondary" className="px-2" onClick={() => setRenamingSectionId(null)}>✕</Button>
                          </div>
                        ) : (
                          <>
                            <button
                              className={`${railItem} pr-14 ${selectedSection === s._id ? railActive : railIdle}`}
                              onClick={() => setSelectedSection(s._id)}
                            >
                              <span className="truncate" title={s.name}>{s.name}</span>
                              <span className="shrink-0 tabular-nums opacity-70">{countFor(s._id)}</span>
                            </button>
                            <div className="absolute right-1 top-1.5 flex items-center gap-0.5">
                              {DIFFICULTY_BUCKETS.map((b) => b.toLowerCase()).includes(s.name.toLowerCase()) && (
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    s.name.toLowerCase() === "easy" ? "bg-success" : s.name.toLowerCase() === "medium" ? "bg-warning" : "bg-danger"
                                  }`}
                                  title={`${s.name} bucket`}
                                />
                              )}
                              {isEditable && (
                                <>
                                  <button
                                    type="button"
                                    title="Rename"
                                    onClick={() => { setRenamingSectionId(s._id); setRenameValue(s.name); }}
                                    className="flex h-6 w-6 items-center justify-center rounded-sm text-xs text-stone-500 transition-colors hover:bg-primary-light hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                                  >
                                    ✎
                                  </button>
                                  {canManage && (
                                    <button
                                      type="button"
                                      title="Delete section"
                                      onClick={() => handleDeleteSection(s)}
                                      className="flex h-6 w-6 items-center justify-center rounded-sm text-xs text-stone-500 transition-colors hover:bg-red-50 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                                    >
                                      🗑
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}

                    {isEditable && (
                      <div className="space-y-2 border-t border-line pt-3">
                        <div className="flex gap-1.5">
                          {DIFFICULTY_BUCKETS.map((b) => (
                            <button
                              key={b}
                              type="button"
                              disabled={addingSection}
                              onClick={() => handleAddSection(b)}
                              title={`Create "${b}" bucket`}
                              className="h-7 flex-1 rounded-sm bg-primary-light text-xs font-medium text-ink transition-colors hover:bg-stone-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                        <input
                          value={newSectionName}
                          onChange={(e) => setNewSectionName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddSection()}
                          placeholder='New section, e.g. "Speed and Time"'
                          className="h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                        />
                        <Button size="sm" variant="secondary" className="w-full" disabled={addingSection || !newSectionName.trim()} onClick={() => handleAddSection()}>
                          + Add
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </aside>

              <div className="min-w-0 flex-1">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[18px] font-semibold text-ink">
                    {selectedSection === "all"
                      ? `All Questions (${questions.length})`
                      : selectedSection === "ungrouped"
                        ? `Ungrouped (${countFor("ungrouped")})`
                        : `${sections.find((s) => s._id === selectedSection)?.name || "Section"} (${countFor(selectedSection)})`}
                  </h2>
                  {isEditable && !editingQuestion && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setShowJsonImport(true)}>
                        + Import JSON
                      </Button>
                      <Button size="sm" onClick={() => setShowAddForm(true)}>
                        + Add Question
                      </Button>
                    </div>
                  )}
                </div>

                {showAddForm && isEditable && (
                  <QuestionEditor
                    initial={newQuestionInitial()}
                    onSave={handleAddQuestion}
                    onCancel={() => setShowAddForm(false)}
                    saving={savingQuestion}
                    sections={sections}
                    uploadImage={uploadImage}
                  />
                )}

                {visibleQuestions.length === 0 && !showAddForm && (
                  <div className="rounded-md border border-line bg-surface shadow-sm">
                    <EmptyState
                      title="No questions here yet"
                      description="Teammates' additions appear automatically as they save."
                    />
                  </div>
                )}

                <div className="space-y-4">
                  {visibleQuestions.map((q, idx) =>
                    editingQuestion?._id === q._id ? (
                      <QuestionEditor
                        key={q._id}
                        initial={q}
                        onSave={handleUpdateQuestion}
                        onCancel={() => setEditingQuestion(null)}
                        saving={savingQuestion}
                        sections={sections}
                        uploadImage={uploadImage}
                      />
                    ) : (
                      <Card key={q._id}>
                        <CardHeader className="flex items-start justify-between gap-3 pb-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary text-xs font-semibold text-white">
                              {idx + 1}
                            </span>
                            <Badge variant="neutral">{q.type.replace("_", " ")}</Badge>
                            {q.contentType === "code" && <Badge variant="accent">{"</>"}</Badge>}
                            {q.imageUrl && <Badge variant="neutral">Image</Badge>}
                          </div>
                          {isEditable && (
                            <div className="flex shrink-0 gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => { setShowAddForm(false); setEditingQuestion(q); }}
                              >
                                Edit
                              </Button>
                              <Button size="sm" variant="dangerGhost" onClick={() => handleRemoveQuestion(q)}>
                                Remove
                              </Button>
                            </div>
                          )}
                        </CardHeader>
                        <CardBody className="pt-2">
                          <div className="[&_p]:!mb-1">
                            <QuestionBody question={q} />
                          </div>
                          {q.type === "mcq" && q.options?.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {q.options.map((o, i) => (
                                <span
                                  key={i}
                                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                                    o === q.correctAnswer
                                      ? "bg-green-50 text-green-700 ring-green-600/20"
                                      : "bg-canvas text-stone-600 ring-line"
                                  }`}
                                >
                                  {OPTION_LETTERS[i]}: <RichInline text={o} /> {o === q.correctAnswer && "✔"}
                                </span>
                              ))}
                            </div>
                          )}
                        </CardBody>
                        <CardFooter className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                          <Badge variant={DIFFICULTY_VARIANT[q.constraints?.difficultyLevel || "medium"] || "neutral"}>
                            {q.constraints?.difficultyLevel || "medium"}
                          </Badge>
                          <span>{q.points || 1} mark{(q.points || 1) !== 1 ? "s" : ""}</span>
                          {(() => {
                            const sec = sections.find((s) => String(s._id) === String(q.sectionId));
                            return sec ? <span>§ {sec.name}</span> : null;
                          })()}
                          <span className="ml-auto" title="Added by">by {authorName(q)}</span>
                        </CardFooter>
                      </Card>
                    )
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ═══ TEAM TAB ═══════════════════════════════════════════ */}
        {tab === "team" && (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Training Team</CardTitle>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                Everyone listed here can open this draft from their dashboard and add questions in parallel.
                Their saves never overwrite each other — every question is appended atomically.
              </p>
            </CardHeader>
            <CardBody className="pt-0">
              {canManage && isEditable ? (
                <form onSubmit={handleInvite} className="flex flex-col gap-2.5 sm:flex-row">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@college.edu"
                    required
                    className="h-10 flex-1 rounded-sm border border-line bg-surface px-3 text-sm text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                  />
                  <Button type="submit" disabled={inviting}>
                    {inviting ? "Adding…" : "+ Add Collaborator"}
                  </Button>
                </form>
              ) : (
                <p className="text-[13px] text-ink-muted">
                  {isCreator ? "Only while the exam is a draft." : "Only the creator can add teammates."}
                </p>
              )}

              <div className="mt-5 divide-y divide-line rounded-sm border border-line">
                {collaborators.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-ink-muted">Loading team…</p>
                )}
                {collaborators.map((m) => (
                  <div key={m._id || m.userId} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-light text-sm font-semibold text-accent-dark">
                      {(m.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                      <p className="truncate text-xs text-ink-muted">{m.email}</p>
                    </div>
                    <Badge variant={m.role === "creator" ? "accent" : "neutral"}>
                      {m.role === "creator" ? "Creator" : "Contributor"}
                    </Badge>
                    {canManage && m.role !== "creator" && isEditable && (
                      <Button size="sm" variant="dangerGhost" onClick={() => handleRemoveMember(m)}>
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* ═══ REVIEW TAB ═════════════════════════════════════════ */}
        {tab === "review" && (
          <div className="space-y-5">
            {!review ? (
              <div className="rounded-md border border-line bg-surface shadow-sm">
                <EmptyState title="Building the consolidated view…" />
              </div>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    [review.stats.totalQuestions, "Questions"],
                    [review.stats.totalPoints, "Total Marks"],
                    [review.stats.sectionCount, "Sections"],
                    [review.stats.authors.length, "Contributors"],
                  ].map(([value, label]) => (
                    <div key={label} className="rounded-md border border-line bg-surface p-4 shadow-sm">
                      <dd className="text-[26px] font-bold leading-none tracking-tight text-ink">{value}</dd>
                      <dt className="mt-1.5 text-[13px] text-ink-muted">{label}</dt>
                    </div>
                  ))}
                </dl>

                <div className="flex flex-wrap gap-1.5">
                  {review.stats.authors.map((a) => (
                    <Badge key={a._id} variant="neutral">
                      {a.name} · {a.count} Q · {a.points} pts
                    </Badge>
                  ))}
                </div>

                {/* Creator lifecycle actions */}
                <Card>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <Badge dot variant={(STATUS_META[exam.status] || STATUS_META.draft).variant}>
                        {(STATUS_META[exam.status] || STATUS_META.draft).label}
                      </Badge>
                      {exam.submittedForReviewAt && (
                        <small className="text-xs text-ink-muted">
                          submitted {new Date(exam.submittedForReviewAt).toLocaleString()}
                        </small>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {isEditable && exam.status === "draft" && canManage && (
                        <Button size="sm" variant="secondary" disabled={statusBusy} onClick={() => handleSetStatus("ready_for_review")}>
                          Submit for Review
                        </Button>
                      )}
                      {isEditable && exam.status === "ready_for_review" && (
                        <Button size="sm" variant="secondary" disabled={statusBusy} onClick={() => handleSetStatus("draft")}>
                          Reopen Editing
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>

                {/* Consolidated listing */}
                {review.sections.map((section) => (
                  <section key={section._id}>
                    <h3 className="mb-2.5 text-[15px] font-semibold text-ink">
                      § {section.name} <span className="font-normal text-ink-muted">({section.questions.length})</span>
                    </h3>
                    {section.questions.length === 0 && (
                      <p className="text-[13px] italic text-ink-muted">No questions filed here yet.</p>
                    )}
                    <AuthorGroups questions={section.questions} authors={review.stats.authors} />
                  </section>
                ))}

                {review.ungrouped.length > 0 && (
                  <section>
                    <h3 className="mb-2.5 text-[15px] font-semibold text-ink">
                      Ungrouped <span className="font-normal text-ink-muted">({review.ungrouped.length})</span>
                    </h3>
                    <AuthorGroups questions={review.ungrouped} authors={review.stats.authors} />
                  </section>
                )}

                {/* Publish panel — timing lives HERE, not at creation */}
                {canManage && (
                  <Card className="border-accent/40">
                    <CardHeader>
                      <CardTitle>Publish</CardTitle>
                    </CardHeader>
                    <CardBody className="pt-0">
                      {exam.status === "published" ? (
                        <div className="space-y-2 text-sm text-ink-muted">
                          <p className="text-ink">
                            Live. Students join with code{" "}
                            <strong className="rounded-sm bg-canvas px-2 py-0.5 font-mono tracking-wider text-ink ring-1 ring-inset ring-line">
                              {exam.examCode}
                            </strong>
                          </p>
                          <p className="text-[13px]">
                            Window: {exam.scheduledAt ? new Date(exam.scheduledAt).toLocaleString() : "—"} · {exam.duration} min
                          </p>
                          <p className="text-[13px]">Manage closing/unpublishing from the dashboard.</p>
                        </div>
                      ) : isEditable ? (
                        <>
                          <p className="text-[13px] leading-relaxed text-ink-muted">
                            Publishing generates the student join code. Set the schedule now — this is the
                            step where date &amp; duration become mandatory.
                          </p>
                          <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
                            <Input
                              label="Exam Opens At *"
                              type="datetime-local"
                              value={publishAt}
                              onChange={(e) => setPublishAt(e.target.value)}
                              required
                            />
                            <Input
                              label="Duration (minutes) *"
                              type="number"
                              min="1"
                              value={publishDuration}
                              onChange={(e) => setPublishDuration(parseInt(e.target.value) || 0)}
                              required
                            />
                          </div>
                          {questions.length === 0 && (
                            <Alert variant="error" className="mt-4 max-w-xl">
                              Add at least one question before publishing.
                            </Alert>
                          )}
                          <Button className="mt-4" onClick={handlePublish} disabled={publishing || questions.length === 0}>
                            {publishing ? "Publishing…" : "Publish Exam"}
                          </Button>
                        </>
                      ) : (
                        <p className="text-sm text-ink-muted">This exam can no longer be published.</p>
                      )}
                    </CardBody>
                  </Card>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <ExamQuestionsJsonImport
        open={showJsonImport}
        onClose={() => setShowJsonImport(false)}
        onConfirm={handleJsonImport}
        sections={sections}
      />
    </AppLayout>
  );
};

// Helpers kept outside the component -----------------------------------------
const AuthorGroups = ({ questions, authors }) => {
  const byAuthor = new Map();
  questions.forEach((q) => {
    const id = String(q.createdBy || "unknown");
    if (!byAuthor.has(id)) byAuthor.set(id, []);
    byAuthor.get(id).push(q);
  });
  const nameOf = (id) => authors.find((a) => String(a._id) === id)?.name || "Unknown";

  return (
    <div className="space-y-5">
      {[...byAuthor.entries()].map(([id, qs]) => (
        <div key={id}>
          <div className="mb-2 flex items-center gap-2 text-[13px] text-ink-muted">
            Added by <strong className="font-semibold text-ink">{nameOf(id)}</strong>
            <span>({qs.length})</span>
            <span className="h-px flex-1 bg-line" aria-hidden="true" />
          </div>
          <div className="space-y-3">
            {qs.map((q) => (
              <Card key={q._id}>
                <CardBody className="py-4">
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="neutral">{q.type.replace("_", " ")}</Badge>
                    {q.contentType === "code" && <Badge variant="accent">{"</>"}</Badge>}
                    <Badge variant={
                      q.constraints?.difficultyLevel === "easy" ? "success"
                        : q.constraints?.difficultyLevel === "hard" ? "danger"
                          : "warning"
                    }>
                      {q.constraints?.difficultyLevel || "medium"}
                    </Badge>
                    <span className="text-xs text-ink-muted">
                      {q.points || 1} pt{(q.points || 1) !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="[&_p]:!mb-1">
                    <QuestionBody question={q} />
                  </div>
                  {q.type === "mcq" && q.options?.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {q.options.map((o, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                            o === q.correctAnswer
                              ? "bg-green-50 text-green-700 ring-green-600/20"
                              : "bg-canvas text-stone-600 ring-line"
                          }`}
                        >
                          {String.fromCharCode(65 + i)}: <RichInline text={o} /> {o === q.correctAnswer && "✔"}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2.5 text-[13px] text-stone-600">
                    ✔ Correct: <strong className="font-semibold text-ink">{q.correctAnswer}</strong>
                    {q.modelAnswer && (
                      <em className="ml-1.5 not-italic text-ink-muted">
                        · model: {q.modelAnswer.slice(0, 80)}{q.modelAnswer.length > 80 ? "…" : ""}
                      </em>
                    )}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ExamDraftWorkspace;
