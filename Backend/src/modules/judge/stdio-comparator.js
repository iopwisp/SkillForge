/**
 * Pure STDIO output comparator.
 *
 * Used by the STDIO judge to decide whether a student program's actual
 * stdout matches the instructor-authored expected stdout under one of
 * three configurable modes.
 *
 * This module is intentionally dependency-free — no imports from `fs`,
 * `child_process`, `path`, `os`, or any other module. It operates on
 * plain strings and is exported for direct property testing in
 * `test/stdio-comparator.test.mjs`.
 */

/**
 * Compare actual program output against expected output under the given mode.
 *
 * @param {'EXACT' | 'TRIMMED' | 'WHITESPACE_NORMALIZED'} mode
 *   - `EXACT`: byte-for-byte comparison, no normalization.
 *   - `TRIMMED`: strips a single optional trailing `\n` or `\r\n` from
 *     each side before comparing.
 *   - `WHITESPACE_NORMALIZED`: collapses every maximal run of ASCII
 *     whitespace (space, tab, newline, vertical tab, form feed, carriage
 *     return) into a single space, then trims leading/trailing whitespace
 *     from each side before comparing.
 * @param {string} actual  - The student program's stdout.
 * @param {string} expected - The instructor-authored expected stdout.
 * @returns {boolean} `true` if the outputs match under the given mode.
 */
export function compareStdio(mode, actual, expected) {
  switch (mode) {
    case 'EXACT':
      return actual === expected;
    case 'TRIMMED':
      return stripOneTrailingNewline(actual) === stripOneTrailingNewline(expected);
    case 'WHITESPACE_NORMALIZED':
      return normalizeWs(actual) === normalizeWs(expected);
    default:
      throw new Error(`Unknown comparator mode: ${mode}`);
  }
}

/**
 * Strip at most one trailing newline (`\n` or `\r\n`) from the end of a
 * string. If the string does not end with a newline, it is returned
 * unchanged.
 *
 * @param {string} s
 * @returns {string}
 */
export function stripOneTrailingNewline(s) {
  if (s == null) return '';
  const str = String(s);
  if (str.endsWith('\r\n')) return str.slice(0, -2);
  if (str.endsWith('\n')) return str.slice(0, -1);
  return str;
}

/**
 * Collapse every maximal run of whitespace characters into a single space
 * and trim leading/trailing whitespace. Uses JavaScript's `\s` which
 * covers the six ASCII whitespace bytes (0x20, 0x09, 0x0A, 0x0B, 0x0C,
 * 0x0D) plus Unicode whitespace — acceptable for v1 since non-ASCII
 * whitespace in STDIO problems is a documented non-goal.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeWs(s) {
  return s.replace(/[\s]+/g, ' ').replace(/^\s+|\s+$/g, '');
}
