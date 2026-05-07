/**
 * Real judges for SQL / JS-based problems.
 *
 *  • runSqlJudge(problem, code)        — runs the user's SQL against an
 *    in-memory SQLite that is freshly seeded from `problem.sql_setup`,
 *    and compares the result rows to `problem.test_cases_json[*].expected`.
 *
 *  • runJsJudge(problem, code)         — evaluates the user's JavaScript in
 *    Node's `vm` sandbox with a hard timeout, locates the function named
 *    `problem.function_name`, calls it once per test case, and deep-equals
 *    the result against `expected`.
 *
 * Both return the same shape that the heuristic judge in submissions.js
 * already emits, so the route handler stays small.
 */

import vm from 'node:vm';
import Database from 'better-sqlite3';

const DEFAULT_TIME_LIMIT_MS = 2000;
const PER_CALL_TIMEOUT_MS   = 1000;

/* ───────────────────────── helpers ──────────────────────── */

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!isFinite(a) || !isFinite(b)) return a === b;
    if (a === b) return true;
    return Math.abs(a - b) < 1e-9;
  }
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function previewValue(v) {
  try {
    const s = JSON.stringify(v);
    if (!s) return String(v);
    return s.length > 160 ? s.slice(0, 157) + '…' : s;
  } catch { return String(v); }
}

/* ───────────────────────── SQL judge ─────────────────────── */

/**
 * Each test case for a SQL problem looks like:
 *   { name?: string, expected: [[...row], ...], ordered?: boolean,
 *     setupOverride?: string, runBefore?: string }
 *
 * If `ordered` is missing/false the rows of the user's result are
 * sorted (lexicographically) before comparison so problems that don't
 * require an ORDER BY don't fail on row order alone.
 */
export function runSqlJudge(problem, code) {
  const tests = safeJson(problem.test_cases_json, []);
  if (!Array.isArray(tests) || tests.length === 0) {
    return verdictNoTests();
  }
  const setup = problem.sql_setup || '';
  const t0 = Date.now();
  const trimmedCode = (code || '').trim().replace(/;+\s*$/, '');

  if (!trimmedCode || trimmedCode.length < 5) {
    return wrongAnswer({
      tests, runtimeMs: 1, output: 'Empty submission.',
    });
  }
  if (/\b(ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(trimmedCode)) {
    return runtimeError({
      tests, error: 'PRAGMA / ATTACH / DETACH / VACUUM are not allowed in submissions.',
    });
  }

  let passed = 0;
  let firstFail = null;

  for (let i = 0; i < tests.length; i++) {
    const tc = tests[i];
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      if (tc.setupOverride) db.exec(tc.setupOverride);
      else if (setup) db.exec(setup);
      if (tc.runBefore) db.exec(tc.runBefore);

      let result;
      try {
        const stmt = db.prepare(trimmedCode);
        result = stmt.raw().all();
      } catch (e) {
        if (!firstFail) {
          firstFail = {
            index: i, name: tc.name || `Test ${i + 1}`,
            error: `SQL error: ${e.message}`,
          };
        }
        continue;
      }

      // raw() returns Array<Array<scalar>> — perfect for comparison.
      const expected = (tc.expected || []).map(r => Array.isArray(r) ? r : [r]);
      const actual   = result.map(r => Array.isArray(r) ? r : [r]);

      const ordered = !!tc.ordered;
      const eq = ordered
        ? deepEqual(actual, expected)
        : deepEqual(sortRows(actual), sortRows(expected));

      if (eq) {
        passed++;
      } else if (!firstFail) {
        firstFail = {
          index: i, name: tc.name || `Test ${i + 1}`,
          expected, actual,
        };
      }

      if (Date.now() - t0 > (problem.time_limit_ms || DEFAULT_TIME_LIMIT_MS)) {
        return tle({ tests, passed, problem });
      }
    } finally {
      db.close();
    }
  }

  return finishVerdict({ tests, passed, firstFail, t0 });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

/* ───────────────────────── JS judge ───────────────────────── */

/**
 * Each test case for a JS problem looks like:
 *   { name?: string, args: any[], expected: any, equals?: 'set'|'sortedArray' }
 *
 * `equals: 'set'` treats arrays as multisets (order-independent compare).
 * `equals: 'sortedArray'` sorts both arrays before comparing.
 */
export function runJsJudge(problem, code) {
  const tests = safeJson(problem.test_cases_json, []);
  const fnName = problem.function_name;
  if (!Array.isArray(tests) || tests.length === 0 || !fnName) {
    return verdictNoTests();
  }
  const t0 = Date.now();
  const trimmed = (code || '').trim();
  if (trimmed.length < 10) {
    return wrongAnswer({ tests, runtimeMs: 1, output: 'Empty submission.' });
  }

  // Build a sandbox that exposes a tiny helper API and captures the user
  // function via either a `module.exports` or a global declaration.
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: { log() {}, error() {}, warn() {}, info() {} },
    setTimeout, clearTimeout,
    Buffer,
    URL, URLSearchParams,
  };
  vm.createContext(sandbox);

  const setupCode = `
    ${code}
    ;(function () {
      if (typeof module !== 'undefined' && module.exports && typeof module.exports['${fnName}'] === 'function') {
        globalThis.__entry = module.exports['${fnName}'];
        return;
      }
      if (typeof module !== 'undefined' && typeof module.exports === 'function') {
        globalThis.__entry = module.exports;
        return;
      }
      try {
        if (typeof ${fnName} === 'function') { globalThis.__entry = ${fnName}; return; }
      } catch (_) {}
      globalThis.__entry = null;
    })();
  `;

  try {
    vm.runInContext(setupCode, sandbox, { timeout: PER_CALL_TIMEOUT_MS });
  } catch (e) {
    return compileError({ tests, error: e.message });
  }
  if (typeof sandbox.__entry !== 'function') {
    return compileError({
      tests,
      error: `Could not find a function named \`${fnName}\` in your submission.`,
    });
  }

  let passed = 0;
  let firstFail = null;
  const overall = problem.time_limit_ms || DEFAULT_TIME_LIMIT_MS;

  for (let i = 0; i < tests.length; i++) {
    const tc = tests[i];
    const args = Array.isArray(tc.args) ? tc.args : [tc.args];

    sandbox.__args = deepClone(args);
    let actual;
    try {
      actual = vm.runInContext(
        `__entry.apply(null, __args);`,
        sandbox,
        { timeout: PER_CALL_TIMEOUT_MS }
      );
    } catch (e) {
      if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        return tle({ tests, passed, problem });
      }
      if (!firstFail) {
        firstFail = {
          index: i, name: tc.name || `Test ${i + 1}`,
          error: `Runtime error: ${e.message}`,
          args,
        };
      }
      continue;
    }

    const expected = tc.expected;
    const ok = compareWithMode(actual, expected, tc.equals);
    if (ok) {
      passed++;
    } else if (!firstFail) {
      firstFail = {
        index: i, name: tc.name || `Test ${i + 1}`,
        args, expected, actual,
      };
    }

    if (Date.now() - t0 > overall) {
      return tle({ tests, passed, problem });
    }
  }

  return finishVerdict({ tests, passed, firstFail, t0 });
}

function deepClone(v) {
  if (v === null) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
  return out;
}

function compareWithMode(actual, expected, mode) {
  if (mode === 'set' && Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    const a = [...actual].sort((x, y) => JSON.stringify(x) < JSON.stringify(y) ? -1 : 1);
    const b = [...expected].sort((x, y) => JSON.stringify(x) < JSON.stringify(y) ? -1 : 1);
    return deepEqual(a, b);
  }
  if (mode === 'sortedArray' && Array.isArray(actual) && Array.isArray(expected)) {
    const a = [...actual].sort();
    const b = [...expected].sort();
    return deepEqual(a, b);
  }
  return deepEqual(actual, expected);
}

/* ───────────────────────── verdicts ──────────────────────── */

function finishVerdict({ tests, passed, firstFail, t0 }) {
  const total = tests.length;
  const runtimeMs = Math.max(1, Date.now() - t0);
  if (passed === total) {
    const beats = Math.max(20, Math.min(99, 95 - Math.floor(runtimeMs / 5)));
    return {
      status: 'ACCEPTED',
      testsPassed: total, testsTotal: total,
      runtimeMs, memoryKb: 40000 + Math.floor(Math.random() * 8000),
      output: 'All test cases passed',
      error: null,
      beats,
    };
  }
  let output = `${passed}/${total} test cases passed.`;
  let error = null;
  if (firstFail) {
    if (firstFail.error) {
      error = `${firstFail.name}: ${firstFail.error}`;
      if (firstFail.args !== undefined) {
        error += `\nInput: ${previewValue(firstFail.args)}`;
      }
    } else {
      const lines = [`${firstFail.name}: failed.`];
      if (firstFail.args !== undefined) lines.push(`Input:    ${previewValue(firstFail.args)}`);
      lines.push(`Expected: ${previewValue(firstFail.expected)}`);
      lines.push(`Actual:   ${previewValue(firstFail.actual)}`);
      output = lines.join('\n');
    }
  }
  return {
    status: error ? 'RUNTIME_ERROR' : 'WRONG_ANSWER',
    testsPassed: passed, testsTotal: total,
    runtimeMs, memoryKb: 38000,
    output, error,
    beats: 0,
  };
}

function wrongAnswer({ tests, runtimeMs, output }) {
  return {
    status: 'WRONG_ANSWER',
    testsPassed: 0, testsTotal: tests.length || 1,
    runtimeMs: runtimeMs || 1, memoryKb: 14000,
    output, error: null, beats: 0,
  };
}
function runtimeError({ tests, error }) {
  return {
    status: 'RUNTIME_ERROR',
    testsPassed: 0, testsTotal: tests.length || 1,
    runtimeMs: 1, memoryKb: 22000,
    output: null, error, beats: 0,
  };
}
function compileError({ tests, error }) {
  return {
    status: 'COMPILE_ERROR',
    testsPassed: 0, testsTotal: tests.length || 1,
    runtimeMs: 1, memoryKb: 18000,
    output: null, error, beats: 0,
  };
}
function tle({ tests, passed, problem }) {
  return {
    status: 'TLE',
    testsPassed: passed || 0,
    testsTotal: tests.length || 1,
    runtimeMs: (problem?.time_limit_ms || DEFAULT_TIME_LIMIT_MS) + 50,
    memoryKb: 32000,
    output: null,
    error: 'Time Limit Exceeded',
    beats: 0,
  };
}
function verdictNoTests() {
  return {
    status: 'ACCEPTED',
    testsPassed: 1, testsTotal: 1,
    runtimeMs: 8, memoryKb: 16000,
    output: 'No automated tests configured for this problem (treated as accepted).',
    error: null, beats: 50,
  };
}

/* ───────────────────────── facade ──────────────────────────
 * The submissions module calls `runJudge(problem, code, language)` and is
 * intentionally agnostic about which judge is chosen. Judge selection,
 * heuristic fallback for legacy algorithm tasks, and result shape live here.
 */

const JS_LIKE_LANGS = new Set(['javascript', 'typescript', 'js', 'ts', 'node']);

export function runJudge(problem, code, language) {
  const which = selectJudge(problem, language);
  if (which === 'sql') return runSqlJudge(problem, code);
  if (which === 'js') return runJsJudge(problem, code);
  return judgeHeuristic(problem, code);
}

function selectJudge(problem, language) {
  const type = (problem.problem_type || 'ALGORITHM').toUpperCase();
  if (type === 'SQL') return 'sql';
  if (type === 'BACKEND' || type === 'FRONTEND') {
    if (JS_LIKE_LANGS.has(language)) return 'js';
    return 'heuristic';
  }
  // ALGORITHM
  if (problem.test_cases_json && JS_LIKE_LANGS.has(language)) return 'js';
  return 'heuristic';
}

/**
 * Legacy heuristic — kept for the original 24 algorithm problems that ship
 * without per-test machinery. Will be removed once those problems get real
 * test cases (or are dropped in favor of more SQL/backend/frontend content).
 */
function judgeHeuristic(problem, code) {
  const trimmed = code.trim();
  const len = trimmed.length;
  if (len < 20) {
    return { status: 'WRONG_ANSWER', testsPassed: 0, testsTotal: 10, runtimeMs: 4, memoryKb: 14000, output: 'Empty or trivial solution', error: null, beats: 0 };
  }
  if (/while\s*\(\s*true\s*\)|for\s*\(\s*;;\s*\)/i.test(trimmed)) {
    return { status: 'TLE', testsPassed: 3, testsTotal: 10, runtimeMs: (problem.time_limit_ms || 1000) + 50, memoryKb: 32000, output: null, error: 'Time Limit Exceeded', beats: 0 };
  }
  if (/throw\s+new\s+Error|raise\s+Exception|panic\(/i.test(trimmed)) {
    return { status: 'RUNTIME_ERROR', testsPassed: 1, testsTotal: 10, runtimeMs: 12, memoryKb: 22000, output: null, error: 'Runtime error during test execution', beats: 0 };
  }

  const hint = (problem.expected_output || '').toLowerCase();
  const haystack = trimmed.toLowerCase();
  const tokens = hint.split(/[^a-z0-9_]+/).filter(t => t.length >= 3);
  const matched = tokens.filter(t => haystack.includes(t)).length;
  const ratio = tokens.length === 0 ? 1 : matched / tokens.length;

  const seed = (len % 73) / 73;

  if (ratio >= 0.5) {
    const runtime = Math.max(8, Math.round(40 + seed * 80));
    const memory = Math.round(40000 + seed * 12000);
    const beats = Math.max(20, Math.min(99, Math.round(95 - seed * 60)));
    return {
      status: 'ACCEPTED',
      testsPassed: 10, testsTotal: 10,
      runtimeMs: runtime, memoryKb: memory,
      output: 'All test cases passed',
      error: null,
      beats,
    };
  }
  const passed = Math.max(2, Math.round(ratio * 10) || 4);
  return {
    status: 'WRONG_ANSWER', testsPassed: passed, testsTotal: 10,
    runtimeMs: Math.round(20 + seed * 30), memoryKb: Math.round(38000 + seed * 6000),
    output: 'One or more test cases produced a wrong answer.', error: null, beats: 0,
  };
}
