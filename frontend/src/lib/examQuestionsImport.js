// Pure validation/normalization for bulk exam-question JSON imports.
// Kept free of React so it can be unit-tested directly.

const MAX_QUESTIONS = 200;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const QUESTION_TYPES = ["mcq", "true_false", "short_answer", "fill_blank", "essay"];
const DIFFICULTIES = ["easy", "medium", "hard"];
const CODE_LANGUAGES = ["javascript", "python", "java", "c", "cpp", "sql", "json", "plaintext"];

export const JSON_FORMAT_TEMPLATE = `{
  "questions": [
    {
      "type": "mcq",
      "question": "Which data structure processes elements in FIFO order?",
      "options": ["Stack", "Queue", "Binary Tree", "Graph"],
      "correctAnswer": "Queue",
      "points": 1,
      "difficultyLevel": "easy",
      "explanation": "A queue removes the earliest inserted element first."
    },
    {
      "type": "true_false",
      "question": "A binary search tree of n nodes has height O(n) in the worst case.",
      "correctAnswer": "True"
    },
    {
      "type": "short_answer",
      "question": "Explain the difference between a process and a thread.",
      "correctAnswer": "A process has its own memory space; threads share the memory of their parent process.",
      "modelAnswer": "Processes are isolated; threads share address space, files and signals within one process.",
      "points": 3,
      "difficultyLevel": "medium",
      "wordLimit": 60
    },
    {
      "type": "fill_blank",
      "question": "The time complexity of binary search on a sorted array is ____.",
      "correctAnswer": "O(log n)"
    },
    {
      "type": "essay",
      "question": "Discuss how normalization reduces data redundancy in relational databases.",
      "correctAnswer": "Normalization splits tables to remove duplicate facts.",
      "modelAnswer": "Higher normal forms decompose relations so each fact is stored once, reducing update anomalies and redundancy.",
      "points": 5,
      "wordLimit": 150
    },
    {
      "type": "code",
      "question": "What does this JavaScript snippet print?",
      "codeSnippet": { "language": "javascript", "code": "console.log([1, 2, 3].length);" },
      "options": ["2", "3", "undefined"],
      "correctAnswer": "3",
      "difficultyLevel": "easy"
    },
    {
      "type": "code",
      "question": "Rewrite the loop below using Array.map and explain the benefit.",
      "codeSnippet": { "language": "python", "code": "out = []\\nfor x in nums:\\n    out.append(x * 2)" },
      "correctAnswer": "out = [x * 2 for x in nums] — map avoids manual list mutation.",
      "modelAnswer": "Use a comprehension/map: it is declarative and avoids mutating an accumulator."
    }
  ]
}`;

export const FIELD_RULES = [
  ["type", "Required — mcq, true_false, short_answer, fill_blank, essay, or code"],
  ["question", "Required — the question text"],
  ["codeSnippet", "For code questions — { language, code }; type \"code\" requires it"],
  ["options", "mcq / true_false only — array of 2–6 answer options"],
  ["correctAnswer", "Required — must exactly match one option for mcq/true_false"],
  ["modelAnswer", "Optional — reference answer coordinators use when reviewing text responses"],
  ["points", "Optional number ≥ 1 (default 1)"],
  ["difficultyLevel", "Optional — easy, medium or hard (default medium)"],
  ["wordLimit", "Optional integer — max words for text answers"],
  ["explanation", "Optional — shown to students in results"],
  ["section", "Optional — must match an existing section name, else goes to Ungrouped"],
];

const isFilledString = (v) => typeof v === "string" && v.trim().length > 0;

export function validateAndNormalize(raw, sections) {
  const errors = [];
  let parsed;

  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return { errors: [{ row: 0, message: "File is not valid JSON. Check for trailing commas or missing quotes." }], questions: [] };
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.questions;
  if (!Array.isArray(list) || list.length === 0) {
    return { errors: [{ row: 0, message: 'Expected an object with a "questions" array (or a bare array), containing at least one question.' }], questions: [] };
  }
  if (list.length > MAX_QUESTIONS) {
    return { errors: [{ row: 0, message: `Too many questions (${list.length}). Maximum is ${MAX_QUESTIONS} per import.` }], questions: [] };
  }

  const sectionByName = new Map(
    (sections || []).map((s) => [s.name.trim().toLowerCase(), s._id])
  );

  const questions = [];

  list.forEach((q, i) => {
    const row = i + 1;
    const fail = (message) => errors.push({ row, message });
    if (typeof q !== "object" || q === null || Array.isArray(q)) {
      fail("Not an object.");
      return;
    }

    const rawType = String(q.type || "").trim().toLowerCase();
    let type = rawType;
    let wantsCode = false;

    if (rawType === "code") {
      // "code" is accepted shorthand for a code-backed question: with ≥2
      // options it becomes an MCQ on the snippet, otherwise a short answer.
      wantsCode = true;
      const optionCount = Array.isArray(q.options)
        ? q.options.filter((o) => String(o).trim()).length
        : 0;
      type = optionCount >= 2 ? "mcq" : "short_answer";
    } else if (!QUESTION_TYPES.includes(type)) {
      fail(`type "${q.type}" is invalid — use one of: ${QUESTION_TYPES.join(", ")}, or "code".`);
      return;
    }
    if (!isFilledString(q.question)) {
      fail('"question" text is missing.');
      return;
    }
    if (!isFilledString(q.correctAnswer)) {
      fail('"correctAnswer" is missing.');
      return;
    }

    let options = Array.isArray(q.options)
      ? q.options.map((o) => String(o).trim()).filter(Boolean)
      : [];
    if (type === "true_false" && options.length === 0) {
      options = ["True", "False"];
    }

    const isOptionType = type === "mcq" || type === "true_false";
    if (isOptionType) {
      if (options.length < 2) {
        fail(`${type} needs at least 2 non-empty options.`);
        return;
      }
      if (!options.includes(String(q.correctAnswer).trim())) {
        fail(`correctAnswer "${q.correctAnswer}" must exactly match one of the options.`);
        return;
      }
    } else if (options.length > 0) {
      fail(`"${type}" questions should not define options.`);
      return;
    }

    const pointsNum = Number(q.points ?? 1);
    if (!Number.isFinite(pointsNum) || pointsNum < 1) {
      fail(`points "${q.points}" must be a number ≥ 1.`);
      return;
    }

    const difficulty = q.difficultyLevel
      ? String(q.difficultyLevel).trim().toLowerCase()
      : "medium";
    if (!DIFFICULTIES.includes(difficulty)) {
      fail(`difficultyLevel "${q.difficultyLevel}" is invalid — use easy, medium or hard.`);
      return;
    }

    let wordLimit = null;
    if (q.wordLimit != null && q.wordLimit !== "") {
      wordLimit = Number(q.wordLimit);
      if (!Number.isInteger(wordLimit) || wordLimit < 1) {
        fail(`wordLimit "${q.wordLimit}" must be a positive whole number.`);
        return;
      }
    }

    const contentType =
      wantsCode || q.contentType === "code" || !!q.codeSnippet?.code || isFilledString(q.code)
        ? "code"
        : "text";
    let codeSnippet = { code: "", language: "plaintext" };
    if (contentType === "code") {
      // Accept codeSnippet as {language, code}, as a bare string, or as top-level "code".
      const rawSnippet =
        typeof q.codeSnippet === "string"
          ? { language: q.language, code: q.codeSnippet }
          : q.codeSnippet;
      const rawCode = rawSnippet?.code ?? q.code;
      if (!isFilledString(rawCode)) {
        fail('Code questions require the snippet — add codeSnippet: { "language": "…", "code": "…" }.');
        return;
      }
      const lang = String(rawSnippet?.language || q.language || "javascript").toLowerCase();
      if (!CODE_LANGUAGES.includes(lang)) {
        fail(`codeSnippet.language "${lang}" is not supported — use ${CODE_LANGUAGES.join(", ")}.`);
        return;
      }
      codeSnippet = { code: rawCode, language: lang };
    }

    const sectionId =
      typeof q.section === "string" && q.section.trim()
        ? sectionByName.get(q.section.trim().toLowerCase()) ?? null
        : null;

    questions.push({
      type,
      question: q.question.trim(),
      options: isOptionType ? options : [],
      correctAnswer: String(q.correctAnswer).trim(),
      modelAnswer: isFilledString(q.modelAnswer) ? q.modelAnswer.trim() : "",
      points: pointsNum,
      contentType,
      codeSnippet,
      constraints: { wordLimit, difficultyLevel: difficulty },
      explanation: isFilledString(q.explanation) ? q.explanation.trim() : "",
      sectionId,
    });
  });

  return { errors, questions };
}

