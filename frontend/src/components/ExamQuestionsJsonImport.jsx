import React, { useMemo, useState } from "react";
import Button from "./ui/Button";
import Badge from "./ui/Badge";
import Alert from "./ui/Alert";
import Modal from "./ui/Modal";
import {
  FIELD_RULES,
  JSON_FORMAT_TEMPLATE,
  MAX_FILE_BYTES,
  validateAndNormalize,
} from "../lib/examQuestionsImport";

const downloadSample = () => {
  const blob = new Blob([JSON_FORMAT_TEMPLATE], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "questions-template.json";
  a.click();
  URL.revokeObjectURL(url);
};

const ExamQuestionsJsonImport = ({ open, onClose, onConfirm, sections }) => {
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState("");

  const result = useMemo(
    () => (rawText.trim() ? validateAndNormalize(rawText, sections) : { errors: [], questions: [] }),
    [rawText, sections]
  );

  const reset = () => {
    setRawText("");
    setFileName("");
    setReadError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReadError("");
    if (file.size > MAX_FILE_BYTES) {
      setReadError("File is too large — maximum 2 MB.");
      e.target.value = "";
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setRawText(String(ev.target.result || ""));
    reader.onerror = () => setReadError("Could not read that file.");
    reader.readAsText(file);
  };

  const readyToAdd = result.questions.length > 0 && result.errors.length === 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      title="Bulk Import Questions via JSON"
      footer={
        <>
          <span className="mr-auto text-sm text-ink-muted">
            {result.questions.length > 0 && (
              <Badge variant={readyToAdd ? "success" : "warning"}>
                {result.questions.length} question{result.questions.length !== 1 ? "s" : ""} parsed
              </Badge>
            )}
          </span>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(result.questions)}
            disabled={!readyToAdd}
          >
            Add {result.questions.length || ""} Question{result.questions.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {/* ── Workflow hint ── */}
      <div className="mb-4 rounded-md border border-line bg-canvas p-4 text-[13px] leading-relaxed text-stone-600">
        <p className="font-medium text-ink">How this works</p>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
          <li>
            Copy the JSON format below and give it to any AI assistant (e.g.
            ChatGPT): “generate N placement questions in exactly this JSON format”.
          </li>
          <li>Save the reply as a .json file.</li>
          <li>Upload it here — every question is added to this mock test automatically.</li>
        </ol>
      </div>

      {/* ── Format documentation ── */}
      <div className="rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink">Required JSON format</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(JSON_FORMAT_TEMPLATE)}>
              Copy format
            </Button>
            <Button size="sm" variant="secondary" onClick={downloadSample}>
              Download sample
            </Button>
          </div>
        </div>

        <pre className="max-h-56 overflow-auto bg-primary-dark px-4 py-3 font-mono text-[12px] leading-relaxed text-stone-200">
          {JSON_FORMAT_TEMPLATE}
        </pre>

        <dl className="grid gap-x-6 gap-y-1.5 border-t border-line px-4 py-3 text-[12px] sm:grid-cols-2">
          {FIELD_RULES.map(([field, rule]) => (
            <div key={field} className="flex gap-1.5">
              <dt className="shrink-0 font-mono text-accent-dark">{field}</dt>
              <dd className="text-ink-muted">— {rule}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ── Upload / paste ── */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-primary-light focus-within:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          Choose .json file
          <input
            type="file"
            accept=".json,application/json,text/plain"
            className="sr-only"
            onChange={handleFile}
          />
        </label>
        {fileName && (
          <span className="self-center truncate text-[13px] text-ink-muted">
            {fileName}
          </span>
        )}
        <span className="self-center text-[13px] text-ink-muted">or paste below</span>
      </div>

      <textarea
        rows={5}
        value={rawText}
        onChange={(e) => { setRawText(e.target.value); setFileName(""); }}
        placeholder='{"questions": [ … ]}'
        spellCheck={false}
        aria-label="Paste questions JSON"
        className="mt-3 w-full rounded-sm border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink placeholder:text-stone-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      />

      {readError && (
        <Alert variant="error" className="mt-3">{readError}</Alert>
      )}

      {result.errors.length > 0 && (
        <Alert variant="error" title={`${result.errors.length} problem${result.errors.length !== 1 ? "s" : ""} found`} className="mt-3">
          <ul className="ml-4 list-disc space-y-0.5 text-[13px]">
            {result.errors.slice(0, 8).map((err, idx) => (
              <li key={idx}>
                {err.row === 0 ? err.message : `Row ${err.row}: ${err.message}`}
              </li>
            ))}
            {result.errors.length > 8 && (
              <li>…and {result.errors.length - 8} more — fix these and re-upload.</li>
            )}
          </ul>
        </Alert>
      )}

      {readyToAdd && (
        <Alert variant="success" className="mt-3">
          All {result.questions.length} question{result.questions.length !== 1 ? "s" : ""} are valid — press Add to insert them into this mock test.
        </Alert>
      )}
    </Modal>
  );
};

export default ExamQuestionsJsonImport;
