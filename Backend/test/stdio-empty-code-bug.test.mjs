/**
 * Regression test for the STDIO "empty code → ACCEPTED" bug.
 *
 * Production stores `problems.test_cases_json` as TEXT, so `pg` returns
 * a JSON-encoded string. Before the fix, runStdioJudge iterated over
 * the string's characters and `tc.stdin === undefined`; the comparator
 * silently treated `''` actual === `undefined` expected as a match, so
 * empty submissions came back as ACCEPTED.
 *
 * This test passes a problem object whose `test_cases_json` is a STRING
 * (matching the production shape, not the test-fixture shape) and
 * asserts the verdict is WRONG_ANSWER, not ACCEPTED.
 *
 * Doesn't require Postgres, Redis, or Docker. Plain Node.js test runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { runStdioJudge } from '../src/modules/judge/stdio-exec.js';

function nodeAvailable() {
  try {
    const res = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

describe('STDIO judge: empty code regression (pg-shape test_cases_json)', () => {
  // Match the exact pg row shape: TEXT column → JSON-encoded string.
  const problem = {
    id: 999,
    time_limit_ms: 1000,
    memory_limit_mb: 64,
    output_size_cap_kb: 64,
    comparator_mode: 'TRIMMED',
    test_cases_json: JSON.stringify([
      { stdin: '5\n1 2 3 4 5', expected_stdout: '15', visibility: 'SAMPLE' },
      { stdin: '3\n10 20 30',   expected_stdout: '60', visibility: 'HIDDEN' },
    ]),
  };

  it('empty JS code does NOT pass (was ACCEPTED before fix)', { skip: !nodeAvailable() && 'node runtime not available' }, async () => {
    const result = await runStdioJudge(problem, '', 'JAVASCRIPT');
    assert.notEqual(
      result.status,
      'ACCEPTED',
      `Empty code returned ACCEPTED. This means parseTestCases is broken — testsTotal=${result.testsTotal}`,
    );
    // testsTotal should be 2, not 200+ (length of the JSON string).
    assert.equal(result.testsTotal, 2, `Expected testsTotal=2 (parsed array), got ${result.testsTotal} (likely string length)`);
  });

  it('correct JS solution returns ACCEPTED (sanity check that parsing works)', { skip: !nodeAvailable() && 'node runtime not available' }, async () => {
    const code = `
      const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
      const n = parseInt(lines[0], 10);
      const nums = lines[1].split(' ').map(Number);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += nums[i];
      console.log(sum);
    `;
    const result = await runStdioJudge(problem, code, 'JAVASCRIPT');
    assert.equal(result.status, 'ACCEPTED', `expected ACCEPTED, got ${result.status} (error=${result.error})`);
    assert.equal(result.testsPassed, 2);
    assert.equal(result.testsTotal, 2);
  });

  it('test_cases_json passed as array still works (test-fixture shape)', { skip: !nodeAvailable() && 'node runtime not available' }, async () => {
    const fixtureProblem = {
      ...problem,
      test_cases_json: [
        { stdin: '5\n1 2 3 4 5', expected_stdout: '15', visibility: 'SAMPLE' },
      ],
    };
    const code = `
      const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
      const n = parseInt(lines[0], 10);
      const nums = lines[1].split(' ').map(Number);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += nums[i];
      console.log(sum);
    `;
    const result = await runStdioJudge(fixtureProblem, code, 'JAVASCRIPT');
    assert.equal(result.status, 'ACCEPTED');
    assert.equal(result.testsTotal, 1);
  });
});
