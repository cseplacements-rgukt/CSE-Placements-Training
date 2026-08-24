import { describe, test, expect } from 'vitest';
import {
  validateAndNormalize,
  JSON_FORMAT_TEMPLATE,
} from '../lib/examQuestionsImport';

const SECTIONS = [
  { _id: 'sec-easy', name: 'Easy' },
  { _id: 'sec-hard', name: 'Hard' },
];

describe('validateAndNormalize', () => {
  test('parses the shipped format template with zero errors', () => {
    const { errors, questions } = validateAndNormalize(JSON_FORMAT_TEMPLATE, SECTIONS);
    expect(errors).toHaveLength(0);
    expect(questions).toHaveLength(7);

    const mcq = questions[0];
    expect(mcq.type).toBe('mcq');
    expect(mcq.options).toContain('Queue');
    expect(mcq.correctAnswer).toBe('Queue');
    expect(mcq.points).toBe(1);
    expect(mcq.constraints.difficultyLevel).toBe('easy');

    // true_false auto-fills its options
    expect(questions[1].options).toEqual(['True', 'False']);

    const essay = questions[4];
    expect(essay.constraints.wordLimit).toBe(150);
    expect(essay.modelAnswer.length).toBeGreaterThan(0);
  });

  test('"type": "code" with ≥2 options becomes a code MCQ', () => {
    const raw = JSON.stringify({
      questions: [
        {
          type: 'code',
          question: 'What does this print?',
          codeSnippet: { language: 'javascript', code: 'console.log([1,2,3].length)' },
          options: ['2', '3'],
          correctAnswer: '3',
        },
      ],
    });
    const { errors, questions } = validateAndNormalize(raw, []);
    expect(errors).toHaveLength(0);
    expect(questions[0].type).toBe('mcq');
    expect(questions[0].contentType).toBe('code');
    expect(questions[0].codeSnippet.language).toBe('javascript');
  });

  test('"type": "code" without options becomes a code short-answer', () => {
    const raw = JSON.stringify({
      questions: [
        {
          type: 'code',
          question: 'Explain what this function does.',
          codeSnippet: { language: 'python', code: 'def f(n): return n * 2' },
          correctAnswer: 'It doubles n.',
        },
      ],
    });
    const { errors, questions } = validateAndNormalize(raw, []);
    expect(errors).toHaveLength(0);
    expect(questions[0].type).toBe('short_answer');
    expect(questions[0].contentType).toBe('code');
  });

  test('"type": "code" requires the actual snippet text', () => {
    const raw = JSON.stringify({
      questions: [{ type: 'code', question: 'Q?', correctAnswer: 'x' }],
    });
    const { errors } = validateAndNormalize(raw, []);
    expect(errors[0].message).toContain('Code questions require the snippet');
  });

  test('accepts codeSnippet as a bare string with default language javascript', () => {
    const raw = JSON.stringify({
      questions: [
        {
          type: 'mcq',
          question: 'Output?',
          contentType: 'code',
          codeSnippet: 'alert(typeof null)',
          options: ['"object"', '"null"'],
          correctAnswer: '"object"',
        },
      ],
    });
    const { errors, questions } = validateAndNormalize(raw, []);
    expect(errors).toHaveLength(0);
    expect(questions[0].codeSnippet).toEqual({ code: 'alert(typeof null)', language: 'javascript' });
  });

  test('accepts a bare array without the questions wrapper', () => {
    const raw = JSON.stringify([
      { type: 'fill_blank', question: '2 + 2 = ____', correctAnswer: '4' },
    ]);
    const { errors, questions } = validateAndNormalize(raw, SECTIONS);
    expect(errors).toHaveLength(0);
    expect(questions[0].type).toBe('fill_blank');
    expect(questions[0].options).toEqual([]);
  });

  test('maps section names case-insensitively and falls back to ungrouped', () => {
    const raw = JSON.stringify({
      questions: [
        { type: 'mcq', question: 'Q1?', options: ['a', 'b'], correctAnswer: 'a', section: 'EASY ' },
        { type: 'mcq', question: 'Q2?', options: ['a', 'b'], correctAnswer: 'b', section: 'Nope' },
      ],
    });
    const { errors, questions } = validateAndNormalize(raw, SECTIONS);
    expect(errors).toHaveLength(0);
    expect(questions[0].sectionId).toBe('sec-easy');
    expect(questions[1].sectionId).toBeNull();
  });

  test('rejects an mcq whose correctAnswer does not match any option', () => {
    const raw = JSON.stringify({
      questions: [
        { type: 'mcq', question: 'Pick one', options: ['a', 'b'], correctAnswer: 'c' },
      ],
    });
    const { errors, questions } = validateAndNormalize(raw, SECTIONS);
    expect(questions).toHaveLength(0);
    expect(errors[0]).toMatchObject({ row: 1 });
    expect(errors[0].message).toContain('exactly match');
  });

  test('reports invalid types and missing fields per row', () => {
    const raw = JSON.stringify({
      questions: [
        { type: 'puzzle', question: 'x' },
        { type: 'mcq', question: '', options: ['a'], correctAnswer: 'a' },
      ],
    });
    const { errors } = validateAndNormalize(raw, SECTIONS);
    expect(errors.some((e) => e.row === 1 && /type/.test(e.message))).toBe(true);
    expect(errors.some((e) => e.row === 2)).toBe(true);
  });

  test('rejects invalid JSON with a single top-level error', () => {
    const { errors } = validateAndNormalize('{ not json', []);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
  });

  test('rejects payloads above the 200-question cap', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      type: 'mcq',
      question: `Q${i}`,
      options: ['a', 'b'],
      correctAnswer: 'a',
    }));
    const { errors } = validateAndNormalize(JSON.stringify({ questions: many }), []);
    expect(errors[0].message).toContain('Maximum is 200');
  });

  test('normalizes code questions with a supported language', () => {
    const raw = JSON.stringify({
      questions: [
        {
          type: 'short_answer',
          question: 'What does this print?',
          contentType: 'code',
          codeSnippet: { language: 'Python', code: 'print(len([1,2]))' },
          correctAnswer: '2',
        },
      ],
    });
    const { errors, questions } = validateAndNormalize(raw, []);
    expect(errors).toHaveLength(0);
    expect(questions[0].contentType).toBe('code');
    expect(questions[0].codeSnippet).toEqual({ code: 'print(len([1,2]))', language: 'python' });
  });
});
