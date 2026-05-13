// Feature: stdio-judge, Property 8: Comparator mode branches behave as specified
// Feature: stdio-judge, Property 9: Comparator is reflexive for every mode
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { compareStdio, stripOneTrailingNewline, normalizeWs } from '../src/modules/judge/stdio-comparator.js';

/**
 * Validates: Requirements 1.2
 * Property 8: three-branch specification equivalence against hand-written
 * reference implementations (fast-check over arbitrary strings).
 */
describe('stdio-comparator property tests', () => {

  describe('P8: Comparator mode branches behave as specified', () => {

    it('EXACT mode: compareStdio("EXACT", a, b) === (a === b)', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (actual, expected) => {
          const result = compareStdio('EXACT', actual, expected);
          const reference = actual === expected;
          assert.strictEqual(result, reference);
        }),
        { numRuns: 200 }
      );
    });

    it('TRIMMED mode: compareStdio("TRIMMED", a, b) === (stripOneTrailingNewline(a) === stripOneTrailingNewline(b))', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (actual, expected) => {
          const result = compareStdio('TRIMMED', actual, expected);
          const reference = stripOneTrailingNewline(actual) === stripOneTrailingNewline(expected);
          assert.strictEqual(result, reference);
        }),
        { numRuns: 200 }
      );
    });

    it('WHITESPACE_NORMALIZED mode: compareStdio("WHITESPACE_NORMALIZED", a, b) === (normalizeWs(a) === normalizeWs(b))', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (actual, expected) => {
          const result = compareStdio('WHITESPACE_NORMALIZED', actual, expected);
          const reference = normalizeWs(actual) === normalizeWs(expected);
          assert.strictEqual(result, reference);
        }),
        { numRuns: 200 }
      );
    });
  });

  /**
   * Validates: Requirements 1.2
   * Property 9: reflexivity — compareStdio(mode, s, s) === true for every mode.
   */
  describe('P9: Comparator is reflexive for every mode', () => {

    const modes = ['EXACT', 'TRIMMED', 'WHITESPACE_NORMALIZED'];

    it('compareStdio(mode, s, s) === true for every mode and any string s', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...modes),
          fc.string(),
          (mode, s) => {
            assert.strictEqual(compareStdio(mode, s, s), true);
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  // --- Example-based tests (edge cases) ---

  describe('Example-based: EXACT mode', () => {
    it('"hello" vs "hello" → true', () => {
      assert.strictEqual(compareStdio('EXACT', 'hello', 'hello'), true);
    });

    it('"hello\\n" vs "hello" → false', () => {
      assert.strictEqual(compareStdio('EXACT', 'hello\n', 'hello'), false);
    });
  });

  describe('Example-based: TRIMMED mode', () => {
    it('"hello\\n" vs "hello" → true', () => {
      assert.strictEqual(compareStdio('TRIMMED', 'hello\n', 'hello'), true);
    });

    it('"hello\\r\\n" vs "hello" → true', () => {
      assert.strictEqual(compareStdio('TRIMMED', 'hello\r\n', 'hello'), true);
    });

    it('"hello\\n\\n" vs "hello" → false (only strips ONE trailing newline)', () => {
      assert.strictEqual(compareStdio('TRIMMED', 'hello\n\n', 'hello'), false);
    });
  });

  describe('Example-based: WHITESPACE_NORMALIZED mode', () => {
    it('"  hello   world  \\n" vs "hello world" → true', () => {
      assert.strictEqual(compareStdio('WHITESPACE_NORMALIZED', '  hello   world  \n', 'hello world'), true);
    });

    it('"a\\t\\tb" vs "a b" → true', () => {
      assert.strictEqual(compareStdio('WHITESPACE_NORMALIZED', 'a\t\tb', 'a b'), true);
    });
  });

  describe('Example-based: Unknown mode throws', () => {
    it('compareStdio("FLOAT", "a", "a") → throws Error', () => {
      assert.throws(() => compareStdio('FLOAT', 'a', 'a'), /Unknown comparator mode/);
    });
  });
});
