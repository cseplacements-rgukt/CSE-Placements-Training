import { render } from '@testing-library/react';
import React from 'react';
import { describe, test, expect } from 'vitest';
import { RichContent, RichInline, QuestionBody } from './RichContent';

describe('RichContent Component', () => {
  test('renders inline math as a KaTeX span', () => {
    const { container } = render(<RichContent text={'Solve $x^2 + 1 = 0$'} />);
    const katexSpan = container.querySelector('.rich-katex');
    expect(katexSpan).toBeTruthy();
    expect(katexSpan.querySelector('.katex')).toBeTruthy();
    expect(katexSpan.textContent).toContain('x');
  });

  test('renders display math as a block-level KaTeX span', () => {
    const { container } = render(
      <RichContent text={'$$\\int_0^1 x \\, dx$$'} />,
    );
    const block = container.querySelector('.rich-katex-block');
    expect(block).toBeTruthy();
    expect(block.querySelector('.katex')).toBeTruthy();
  });

  test('does not treat a lone dollar amount as math', () => {
    const { container } = render(<RichContent text={'It costs $5 today'} />);
    expect(container.querySelector('.katex')).toBeFalsy();
    expect(container.textContent).toContain('It costs $5 today');
  });

  test('highlights fenced code blocks with the requested language', () => {
    const { container } = render(
      <RichContent text={'```js\nconst answer = 42;\n```'} />,
    );
    const code = container.querySelector('pre code');
    expect(code).toBeTruthy();
    expect(code.className).toContain('language-javascript');
    // Prism emits one span.token per lexed token (keyword, number, ...)
    const tokens = container.querySelectorAll('.token');
    expect(tokens.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('const');
  });

  test('falls back to plain pre for bare fences', () => {
    const { container } = render(
      <RichContent text={'```\nMOVE 1 TO X.\n```'} />,
    );
    const fallback = container.querySelector('pre.rich-code-fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent).toBe('MOVE 1 TO X.\n');
  });

  test('renders backtick inline code without highlighting', () => {
    const { container } = render(<RichContent text={'call `foo()` now'} />);
    const inlineCode = container.querySelector('code.rich-inline-code');
    expect(inlineCode).toBeTruthy();
    expect(inlineCode.textContent).toBe('foo()');
  });

  test('splits mixed content into paragraphs and code blocks', () => {
    const { container } = render(
      <RichContent text={'Before\n```python\nx = 1\n```\nAfter'} />,
    );
    expect(container.querySelectorAll('.rich-paragraph').length).toBe(2);
    expect(container.querySelector('code.language-python')).toBeTruthy();
  });
});

describe('RichInline Component', () => {
  test('renders inline math inside a span without block wrapper', () => {
    const { container } = render(<RichInline text={'area = $\\pi r^2$'} />);
    expect(container.querySelector('.rich-inline')).toBeTruthy();
    expect(container.querySelector('.rich-katex .katex')).toBeTruthy();
  });

  test('renders inline code tokens', () => {
    const { container } = render(<RichInline text={'use `sort()` here'} />);
    expect(container.querySelector('code.rich-inline-code').textContent).toBe(
      'sort()',
    );
  });
});

describe('QuestionBody Component', () => {
  test('renders attached code snippet before the question text', () => {
    const { container } = render(
      <QuestionBody
        question={{
          contentType: 'code',
          codeSnippet: { code: 'def f():\n    pass\n', language: 'python' },
          question: 'What does $f$ return?',
        }}
      />,
    );
    expect(container.querySelector('code.language-python')).toBeTruthy();
    expect(container.querySelector('.rich-katex .katex')).toBeTruthy();
  });

  test('hides the image when showImage is false', () => {
    const { container } = render(
      <QuestionBody
        showImage={false}
        question={{ question: 'plain', imageUrl: 'https://example.com/x.png' }}
      />,
    );
    expect(container.querySelector('img')).toBeFalsy();
  });
});
