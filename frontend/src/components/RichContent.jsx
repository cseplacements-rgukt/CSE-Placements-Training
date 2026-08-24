import React, { useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
// Must be the PRISM build: the grammars registered below come from
// languages/prism/* and the theme from styles/prism/*. The hljs-based `Light`
// build silently renders everything as plain text with those inputs.
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("c", c);
SyntaxHighlighter.registerLanguage("cpp", cpp);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("json", json);

const LANGUAGE_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  ts: "javascript",
  py: "python",
  "c++": "cpp",
};

const resolveLanguage = (lang) => {
  const l = (lang || "").trim().toLowerCase();
  return LANGUAGE_ALIASES[l] || l || "plaintext";
};

const renderKatex = (tex, displayMode) => {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode,
      output: "html",
    });
  } catch {
    return null;
  }
};

const KatexSpan = ({ tex, displayMode = false }) => {
  const html = useMemo(() => renderKatex(tex, displayMode), [tex, displayMode]);
  if (html === null) return <span>{tex}</span>;
  return (
    <span
      className={
        displayMode
          ? "rich-katex rich-katex-block my-2 block overflow-x-auto text-center [&_.katex]:text-[1.05em]"
          : "rich-katex inline-block [&_.katex]:text-[1.05em]"
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

const CodeBlock = ({ code, language }) => {
  const lang = resolveLanguage(language);
  if (lang === "plaintext") {
    return (
      <pre className="rich-code-fallback my-2 overflow-x-auto rounded-sm bg-[#282c34] p-3 font-mono text-[13px] leading-relaxed text-[#abb2bf]">
        {code}
      </pre>
    );
  }
  return (
    <SyntaxHighlighter
      language={lang}
      style={oneDark}
      customStyle={{ borderRadius: 8, fontSize: "0.85rem", margin: "8px 0" }}
      wrapLongLines={false}
    >
      {code}
    </SyntaxHighlighter>
  );
};

// Split text into tokens: fenced code, $$display math$$, $inline math$, `code`
const tokenizeInline = (text) => {
  const tokens = [];
  let buffer = "";
  let i = 0;
  const pushText = () => {
    if (buffer) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };
  while (i < text.length) {
    if (text[i] === "$" && text[i + 1] === "$") {
      const end = text.indexOf("$$", i + 2);
      if (end !== -1) {
        pushText();
        tokens.push({ type: "math", value: text.slice(i + 2, end), displayMode: true });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "$") {
      const end = text.indexOf("$", i + 1);
      // A lone "$" followed by whitespace is currency, not math
      if (end > i + 1 && !/^\s/.test(text.slice(i + 1))) {
        const inner = text.slice(i + 1, end);
        if (!inner.includes("\n")) {
          pushText();
          tokens.push({ type: "math", value: inner, displayMode: false });
          i = end + 1;
          continue;
        }
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1 && end > i + 1) {
        pushText();
        tokens.push({ type: "code", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  pushText();
  return tokens;
};

const InlineTokens = ({ text }) =>
  tokenizeInline(text).map((token, idx) => {
    if (token.type === "math") {
      return <KatexSpan key={idx} tex={token.value} displayMode={token.displayMode} />;
    }
    if (token.type === "code") {
      return (
        <code
          key={idx}
          className="rich-inline-code rounded-sm border border-line bg-primary-light px-[5px] py-px font-mono text-[0.85em]"
        >
          {token.value}
        </code>
      );
    }
    return <React.Fragment key={idx}>{token.value}</React.Fragment>;
  });

// Split a block of text into fenced code blocks and plain paragraphs first.
const splitFences = (text) => {
  const parts = [];
  const re = /```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push({ kind: "text", value: text.slice(last, match.index) });
    parts.push({ kind: "fence", language: match[1], value: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
};

/**
 * RichContent renders question text that may contain:
 *   - KaTeX inline math  $x^2$      and display math $$\int x dx$$
 *   - fenced code blocks ```js ... ```
 *   - inline code        `foo()`
 */
export const RichContent = ({ text, className = "" }) => (
  <div className={`rich-content leading-[1.55] ${className}`}>
    {splitFences(text || "").map((part, idx) => {
      if (part.kind === "fence") {
        return <CodeBlock key={idx} code={part.value} language={part.language} />;
      }
      return (
        <p key={idx} className="rich-paragraph mb-1.5 whitespace-pre-wrap break-words last:mb-0">
          <InlineTokens text={part.value} />
        </p>
      );
    })}
  </div>
);

/** Inline variant for options / tight table cells (no block-level layout). */
export const RichInline = ({ text }) => (
  <span className="rich-inline"><InlineTokens text={text || ""} /></span>
);

/**
 * Question image with lazy loading and a pre-reserved 4:3 layout box so the
 * page never jumps when the (possibly slow Cloudinary) image finishes loading.
 */
const QuestionImage = ({ src }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="relative mt-2.5 aspect-[4/3] w-full max-w-lg overflow-hidden rounded-sm border border-line bg-canvas">
      <img
        src={src}
        alt="Question reference"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
};

/**
 * Full question body renderer: renders the text body plus an attached code
 * snippet (contentType === "code") and optional image.
 */
export const QuestionBody = ({ question, showImage = true }) => (
  <>
    {question.contentType === "code" && question.codeSnippet?.code && (
      <CodeBlock code={question.codeSnippet.code} language={question.codeSnippet.language} />
    )}
    <RichContent text={question.question} />
    {showImage && question.imageUrl && <QuestionImage src={question.imageUrl} />}
  </>
);

export default RichContent;
