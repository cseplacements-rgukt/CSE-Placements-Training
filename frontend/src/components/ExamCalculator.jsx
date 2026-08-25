import { useMemo, useState } from "react";
import { calculateExpression } from "../lib/calculatorEngine";

// ═══════════════════════════════════════════════════════════════════
// EXAM CALCULATOR — on-screen scientific calculator
//
// Rendered only when the exam creator enables it (settings.enableCalculator).
// Entirely client-side: no network calls, no backend involvement. The
// expression engine lives in lib/calculatorEngine.js (no eval()).
// ═══════════════════════════════════════════════════════════════════

// Pretty glyphs shown in the display, mapped back to ASCII when evaluated.
const DISPLAY_TO_EXPR = [
  ["×", "*"],
  ["÷", "/"],
  ["−", "-"],
];

const toEvalString = (display) =>
  DISPLAY_TO_EXPR.reduce(
    (acc, [glyph, ascii]) => acc.replaceAll(glyph, ascii),
    display,
  );

const formatResult = (value) => {
  if (Number.isInteger(value)) return String(value);
  const rounded = parseFloat(value.toPrecision(12));
  return String(rounded);
};

// ── Button definitions ───────────────────────────────────────────────
// insert: appended to the expression · action: special key behaviour
const SCI_ROWS = [
  [
    { label: "sin", insert: "sin(", kind: "sci" },
    { label: "cos", insert: "cos(", kind: "sci" },
    { label: "tan", insert: "tan(", kind: "sci" },
    { label: "ln", insert: "ln(", kind: "sci" },
    { label: "log", insert: "log(", kind: "sci" },
  ],
  [
    { label: "√", insert: "sqrt(", kind: "sci" },
    { label: "x²", insert: "^2", kind: "sci" },
    { label: "xʸ", insert: "^", kind: "sci" },
    { label: "n!", insert: "!", kind: "sci" },
    { label: "abs", insert: "abs(", kind: "sci" },
  ],
];
const MAIN_ROWS = [
  [
    { label: "(", insert: "(", kind: "fn" },
    { label: ")", insert: ")", kind: "fn" },
    { label: "AC", action: "clear", kind: "danger" },
    { label: "⌫", action: "backspace", kind: "fn" },
  ],
  [
    { label: "7", insert: "7" },
    { label: "8", insert: "8" },
    { label: "9", insert: "9" },
    { label: "÷", insert: "÷", kind: "op" },
  ],
  [
    { label: "4", insert: "4" },
    { label: "5", insert: "5" },
    { label: "6", insert: "6" },
    { label: "×", insert: "×", kind: "op" },
  ],
  [
    { label: "1", insert: "1" },
    { label: "2", insert: "2" },
    { label: "3", insert: "3" },
    { label: "−", insert: "−", kind: "op" },
  ],
  [
    { label: "0", insert: "0" },
    { label: ".", insert: "." },
    { label: "π", insert: "pi", kind: "op" },
    { label: "+", insert: "+", kind: "op" },
  ],
  [
    { label: "e", insert: "e", kind: "op" },
    { label: "=", action: "equals", kind: "equals", wide: true },
  ],
];

const BUTTON_STYLES = {
  default: "bg-surface text-ink hover:bg-primary-light",
  fn: "bg-primary-light text-ink-muted hover:text-ink",
  sci: "bg-accent-light/40 text-accent-dark hover:bg-accent-light font-medium",
  op: "bg-surface text-ink font-semibold hover:bg-primary-light",
  danger: "bg-surface text-danger font-semibold hover:bg-red-50",
  equals: "bg-accent text-white font-semibold hover:bg-accent-dark",
};

export default function ExamCalculator() {
  const [open, setOpen] = useState(false);
  const [angleMode, setAngleMode] = useState("deg"); // deg | rad
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState(""); // committed after "="

  const preview = useMemo(() => {
    if (!expression.trim()) return "";
    try {
      return formatResult(
        calculateExpression(toEvalString(expression), angleMode),
      );
    } catch {
      return ""; // incomplete mid-typing — show nothing rather than noise
    }
  }, [expression, angleMode]);

  const press = (button) => {
    if (button.action === "clear") {
      setExpression("");
      setResult("");
      return;
    }
    if (button.action === "backspace") {
      setExpression((current) => current.slice(0, -1));
      return;
    }
    if (button.action === "equals") {
      try {
        const value = calculateExpression(
          toEvalString(expression),
          angleMode,
        );
        setResult(`${expression} = ${formatResult(value)}`);
        setExpression(formatResult(value));
      } catch {
        setResult("Error");
      }
      return;
    }
    setExpression((current) => current + button.insert);
  };

  return (
    <div className="fixed bottom-3 right-3 z-40 flex flex-col items-end gap-2 print:hidden">
      {/* Collapsed launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open calculator"
          aria-label="Open calculator"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="11" x2="8" y2="11.01" />
            <line x1="12" y1="11" x2="12" y2="11.01" />
            <line x1="16" y1="11" x2="16" y2="11.01" />
            <line x1="8" y1="15" x2="8" y2="15.01" />
            <line x1="12" y1="15" x2="12" y2="15.01" />
            <line x1="16" y1="15" x2="16" y2="15.01" />
            <line x1="8" y1="19" x2="12" y2="19" />
            <line x1="16" y1="19" x2="16" y2="19.01" />
          </svg>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Scientific calculator"
          className="w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-md"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line bg-primary-light px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Calculator
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setAngleMode((mode) => (mode === "deg" ? "rad" : "deg"))
                }
                title="Toggle angle unit"
                className="rounded-sm border border-line bg-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent-dark transition-colors hover:bg-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                {angleMode}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close calculator"
                className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-stone-200 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Display */}
          <div className="border-b border-line px-3 pb-2 pt-2.5 text-right">
            <div
              className="min-h-[15px] truncate font-mono text-[11px] text-ink-muted"
              title={result}
            >
              {result}
            </div>
            <div
              data-testid="calculator-expression"
              className="min-h-[26px] break-all font-mono text-lg leading-snug text-ink"
            >
              {expression || "0"}
            </div>
            {preview && (
              <div className="font-mono text-[11px] text-success">
                = {preview}
              </div>
            )}
          </div>

          {/* Keys */}
          <div className="space-y-1 p-2">
            {SCI_ROWS.map((row, rowIndex) => (
              <div key={rowIndex} className="grid grid-cols-5 gap-1">
                {row.map((button) => (
                  <CalcButton key={button.label} button={button} onPress={press} />
                ))}
              </div>
            ))}
            {MAIN_ROWS.map((row, rowIndex) => (
              <div key={rowIndex} className="grid grid-cols-4 gap-1">
                {row.map((button) => (
                  <CalcButton
                    key={button.label}
                    button={button}
                    onPress={press}
                    wide={button.wide ? 3 : 1}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CalcButton({ button, onPress, wide = 1 }) {
  const style = BUTTON_STYLES[button.kind || "default"];
  return (
    <button
      type="button"
      onClick={() => onPress(button)}
      style={wide > 1 ? { gridColumn: `span ${wide} / span ${wide}` } : undefined}
      className={`h-9 select-none rounded-md border border-line text-sm tabular-nums transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${style}`}
    >
      {button.label}
    </button>
  );
}
