// ═══════════════════════════════════════════════════════════════════
// CALCULATOR ENGINE — safe scientific expression evaluation
//
// Used by ExamCalculator. No eval(): expressions are tokenized and
// evaluated through shunting-yard → RPN, so malformed input can only
// throw, never execute anything.
// ═══════════════════════════════════════════════════════════════════

const FUNCS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "sqrt", "abs",
]);
const CONSTANTS = { pi: Math.PI, e: Math.E };

// ── Tokenizer ────────────────────────────────────────────────────────
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " ") {
      i += 1;
    } else if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i];
        i += 1;
      }
      if ((num.match(/\./g) || []).length > 1) throw new Error("Bad number");
      tokens.push({ type: "num", value: parseFloat(num) });
    } else if (/[a-z]/i.test(ch)) {
      let name = "";
      while (i < input.length && /[a-z]/i.test(input[i])) {
        name += input[i];
        i += 1;
      }
      const lower = name.toLowerCase();
      if (lower in CONSTANTS) {
        tokens.push({ type: "num", value: CONSTANTS[lower] });
      } else if (FUNCS.has(lower)) {
        tokens.push({ type: "func", value: lower });
      } else {
        throw new Error(`Unknown name "${name}"`);
      }
    } else if ("+-*/^!()".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
    } else {
      throw new Error(`Bad character "${ch}"`);
    }
  }
  return tokens;
}

// ── Shunting-yard → RPN ──────────────────────────────────────────────
// Unary minus ("neg") binds tightest (Excel-style): "-5+3" reads as
// (-5)+3, "2^-2" reads as 2^(-2), and "-2^2" as (-2)^2 — use parens
// for the alternative grouping.
const PRECEDENCE = { "+": 2, "-": 2, "*": 3, "/": 3, "^": 4, neg: 5 };
const RIGHT_ASSOC = new Set(["^", "neg"]);

function isUnaryMinus(tokens, index) {
  if (tokens[index]?.value !== "-") return false;
  if (index === 0) return true;
  const prev = tokens[index - 1];
  return (
    prev.type === "op" && prev.value !== ")" && prev.value !== "!"
  ) || prev.type === "func";
}

function toRPN(tokens) {
  const output = [];
  const stack = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "num") {
      output.push(token);
    } else if (token.type === "func") {
      stack.push(token);
    } else if (token.value === "(") {
      stack.push(token);
    } else if (token.value === ")") {
      while (stack.length && stack.at(-1).value !== "(") {
        output.push(stack.pop());
      }
      if (!stack.length) throw new Error("Unbalanced parentheses");
      stack.pop(); // discard "("
      if (stack.length && stack.at(-1).type === "func") {
        output.push(stack.pop());
      }
    } else if (token.value === "!") {
      output.push(token); // postfix — applies immediately
    } else {
      // Binary operator, or unary minus normalised to "neg".
      const op =
        isUnaryMinus(tokens, i)
          ? { type: "op", value: "neg" }
          : token;
      while (
        stack.length &&
        stack.at(-1).type === "op" &&
        stack.at(-1).value !== "(" &&
        (PRECEDENCE[stack.at(-1).value] > PRECEDENCE[op.value] ||
          (PRECEDENCE[stack.at(-1).value] === PRECEDENCE[op.value] &&
            !RIGHT_ASSOC.has(op.value)))
      ) {
        output.push(stack.pop());
      }
      stack.push(op);
    }
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.value === "(") throw new Error("Unbalanced parentheses");
    output.push(top);
  }
  return output;
}

// ── RPN evaluation ───────────────────────────────────────────────────
function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let result = 1;
  for (let k = 2; k <= n; k += 1) result *= k;
  return result;
}

function evaluateRPN(rpn, angleMode) {
  const values = [];
  const toAngle = (x) => (angleMode === "deg" ? (x * Math.PI) / 180 : x);
  const fromAngle = (x) => (angleMode === "deg" ? (x * 180) / Math.PI : x);
  const applyFunc = {
    sin: (x) => Math.sin(toAngle(x)),
    cos: (x) => Math.cos(toAngle(x)),
    tan: (x) => Math.tan(toAngle(x)),
    asin: (x) => fromAngle(Math.asin(x)),
    acos: (x) => fromAngle(Math.acos(x)),
    atan: (x) => fromAngle(Math.atan(x)),
    ln: (x) => Math.log(x),
    log: (x) => Math.log10(x),
    sqrt: (x) => Math.sqrt(x),
    abs: Math.abs,
  };

  for (const token of rpn) {
    if (token.type === "num") {
      values.push(token.value);
    } else if (token.type === "func") {
      const x = values.pop();
      if (x === undefined) throw new Error("Missing operand");
      values.push(applyFunc[token.value](x));
    } else if (token.value === "neg") {
      const x = values.pop();
      if (x === undefined) throw new Error("Missing operand");
      values.push(-x);
    } else if (token.value === "!") {
      const x = values.pop();
      if (x === undefined) throw new Error("Missing operand");
      values.push(factorial(x));
    } else {
      const b = values.pop();
      const a = values.pop();
      if (a === undefined || b === undefined) throw new Error("Missing operand");
      switch (token.value) {
        case "+": values.push(a + b); break;
        case "-": values.push(a - b); break;
        case "*": values.push(a * b); break;
        case "/": values.push(a / b); break;
        case "^": values.push(a ** b); break;
        default: throw new Error(`Bad operator "${token.value}"`);
      }
    }
  }
  if (values.length !== 1) throw new Error("Incomplete expression");
  return values[0];
}

export function calculateExpression(expression, angleMode) {
  const value = evaluateRPN(toRPN(tokenize(expression)), angleMode);
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error("Result undefined");
  }
  if (!Number.isFinite(value)) throw new Error("Result undefined");
  return value;
}
