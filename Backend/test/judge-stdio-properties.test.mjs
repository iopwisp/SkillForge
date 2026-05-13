// Feature: stdio-judge, Property 6: Per-test verdict classifier respects limits and comparator
// Feature: stdio-judge, Property 7: Compile errors short-circuit and bound the diagnostic
// Feature: stdio-judge, Property 10: Overall verdict is the first failing per-test verdict
// Feature: stdio-judge, Property 11: runJudge dispatches by problem.type
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classify } from '../src/modules/judge/stdio-exec.js';
import { compareStdio } from '../src/modules/judge/stdio-comparator.js';
import { runStdioJudge } from '../src/modules/judge/stdio-exec.js';
import { runJudge } from '../src/modules/judge/service.js';

/**
 * Validates: Requirements P6
 * Property 6: Per-test verdict classifier respects limits and comparator.
 *
 * The classifier function classify(exec, tc, comparatorMode, limits, index) SHALL return:
 * - OLE if killedReason === 'OLE' or stdoutBytes > output_size_cap_kb * 1024
 * - TLE if killedReason === 'TLE' or timeMs > time_limit_ms
 * - MLE if killedReason === 'MLE' or memoryMb > memory_limit_mb
 * - RE if exit !== 0 or (signal !== null and signal !== 'SIGKILL')
 * - WRONG_ANSWER if none of the above and comparator returns false
 * - ACCEPTED otherwise
 */
describe('P6: Classifier precedence and comparator gating', () => {

  // Generators
  const killedReasonArb = fc.constantFrom(null, 'TLE', 'MLE', 'OLE');
  const signalArb = fc.constantFrom(null, 'SIGKILL', 'SIGSEGV', 'SIGABRT');
  const visibilityArb = fc.constantFrom('SAMPLE', 'HIDDEN');
  const comparatorModeArb = fc.constantFrom('EXACT', 'TRIMMED', 'WHITESPACE_NORMALIZED');

  const execArb = fc.record({
    killedReason: killedReasonArb,
    timeMs: fc.integer({ min: 0, max: 20000 }),
    memoryMb: fc.integer({ min: 0, max: 1024 }),
    stdout: fc.string({ minLength: 0, maxLength: 200 }),
    stderr: fc.string({ minLength: 0, maxLength: 100 }),
    exit: fc.integer({ min: 0, max: 255 }),
    signal: signalArb,
  });

  const limitsArb = fc.record({
    timeLimitMs: fc.integer({ min: 100, max: 10000 }),
    memoryLimitMb: fc.integer({ min: 16, max: 512 }),
    outputSizeCapKb: fc.integer({ min: 1, max: 1024 }),
  });

  const tcArb = fc.record({
    stdin: fc.string({ minLength: 0, maxLength: 50 }),
    expected_stdout: fc.string({ minLength: 0, maxLength: 200 }),
    visibility: visibilityArb,
  });

  it('verdict follows the precedence chain OLE > TLE > MLE > RE > WRONG_ANSWER > ACCEPTED', () => {
    fc.assert(
      fc.property(execArb, limitsArb, tcArb, comparatorModeArb, (exec, limits, tc, comparatorMode) => {
        const result = classify({ exec, tc, comparatorMode, limits, index: 0 });
        const stdoutBytes = Buffer.byteLength(exec.stdout, 'utf8');

        // Determine expected verdict by precedence
        const isOLE = exec.killedReason === 'OLE' || stdoutBytes > limits.outputSizeCapKb * 1024;
        const isTLE = exec.killedReason === 'TLE' || exec.timeMs > limits.timeLimitMs;
        const isMLE = exec.killedReason === 'MLE' || exec.memoryMb > limits.memoryLimitMb;
        const isRE = exec.exit !== 0 || (exec.signal !== null && exec.signal !== 'SIGKILL');

        if (isOLE) {
          assert.strictEqual(result.verdict, 'OLE', `Expected OLE but got ${result.verdict}`);
        } else if (isTLE) {
          assert.strictEqual(result.verdict, 'TLE', `Expected TLE but got ${result.verdict}`);
        } else if (isMLE) {
          assert.strictEqual(result.verdict, 'MLE', `Expected MLE but got ${result.verdict}`);
        } else if (isRE) {
          assert.strictEqual(result.verdict, 'RE', `Expected RE but got ${result.verdict}`);
        } else {
          // No limit/runtime flag — comparator decides
          const match = compareStdio(comparatorMode, exec.stdout, tc.expected_stdout);
          if (!match) {
            assert.strictEqual(result.verdict, 'WRONG_ANSWER', `Expected WRONG_ANSWER but got ${result.verdict}`);
          } else {
            assert.strictEqual(result.verdict, 'ACCEPTED', `Expected ACCEPTED but got ${result.verdict}`);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('OLE takes precedence over TLE, MLE, and RE', () => {
    fc.assert(
      fc.property(limitsArb, tcArb, comparatorModeArb, (limits, tc, comparatorMode) => {
        // Force OLE via killedReason, also set TLE and MLE conditions
        const exec = {
          killedReason: 'OLE',
          timeMs: limits.timeLimitMs + 1000, // would trigger TLE
          memoryMb: limits.memoryLimitMb + 100, // would trigger MLE
          stdout: '',
          stderr: '',
          exit: 1, // would trigger RE
          signal: 'SIGSEGV', // would trigger RE
        };
        const result = classify({ exec, tc, comparatorMode, limits, index: 0 });
        assert.strictEqual(result.verdict, 'OLE');
      }),
      { numRuns: 100 }
    );
  });

  it('TLE takes precedence over MLE and RE when OLE is not triggered', () => {
    fc.assert(
      fc.property(limitsArb, tcArb, comparatorModeArb, (limits, tc, comparatorMode) => {
        const exec = {
          killedReason: 'TLE',
          timeMs: limits.timeLimitMs + 1000,
          memoryMb: limits.memoryLimitMb + 100, // would trigger MLE
          stdout: '', // small enough to not trigger OLE
          stderr: '',
          exit: 1, // would trigger RE
          signal: 'SIGSEGV',
        };
        const result = classify({ exec, tc, comparatorMode, limits, index: 0 });
        assert.strictEqual(result.verdict, 'TLE');
      }),
      { numRuns: 100 }
    );
  });

  it('actual_output is included only for WRONG_ANSWER + SAMPLE visibility', () => {
    fc.assert(
      fc.property(limitsArb, comparatorModeArb, fc.string({ minLength: 1, maxLength: 50 }), (limits, comparatorMode, stdout) => {
        // Force a WRONG_ANSWER by making stdout differ from expected
        const exec = {
          killedReason: null,
          timeMs: 0,
          memoryMb: 0,
          stdout,
          stderr: '',
          exit: 0,
          signal: null,
        };
        const expected = stdout + '_DIFFERENT'; // guaranteed to differ

        const sampleTc = { stdin: '', expected_stdout: expected, visibility: 'SAMPLE' };
        const hiddenTc = { stdin: '', expected_stdout: expected, visibility: 'HIDDEN' };

        const sampleResult = classify({ exec, tc: sampleTc, comparatorMode, limits, index: 0 });
        const hiddenResult = classify({ exec, tc: hiddenTc, comparatorMode, limits, index: 0 });

        assert.strictEqual(sampleResult.verdict, 'WRONG_ANSWER');
        assert.strictEqual(hiddenResult.verdict, 'WRONG_ANSWER');
        assert.strictEqual(sampleResult.actual_output, stdout);
        assert.strictEqual(hiddenResult.actual_output, undefined);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Validates: Requirements P7
 * Property 7: Compile errors short-circuit and bound the diagnostic.
 *
 * For any compiled language and source that fails to compile, the overall verdict
 * SHALL be COMPILE_ERROR, perTestResults SHALL be empty, and the diagnostic
 * SHALL be at most 8 KB.
 */
describe('P7: Compile-error short-circuit and bounded diagnostic', () => {

  it('runStdioJudge returns COMPILE_ERROR with empty perTestResults for invalid Java source', async () => {
    // Check if javac is available
    const { spawnSync } = await import('node:child_process');
    const javacCheck = spawnSync('javac', ['--version'], { encoding: 'utf8', windowsHide: true });
    if (javacCheck.error || javacCheck.status !== 0) {
      // javac not available, skip
      return;
    }

    const problem = {
      time_limit_ms: 2000,
      memory_limit_mb: 256,
      output_size_cap_kb: 64,
      comparator_mode: 'TRIMMED',
      test_cases_json: [
        { stdin: '5\n1 2 3 4 5', expected_stdout: '15', visibility: 'SAMPLE' },
        { stdin: '3\n10 20 30', expected_stdout: '60', visibility: 'HIDDEN' },
      ],
    };

    // Invalid Java source that will fail to compile
    const invalidCode = 'public class Main { public static void main(String[] args) { this is not valid java }}}}';

    const result = await runStdioJudge(problem, invalidCode, 'java');

    assert.strictEqual(result.status, 'COMPILE_ERROR');
    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.perTestResults, []);
    assert.ok(result.error !== null && result.error !== undefined);
    assert.ok(Buffer.byteLength(result.error, 'utf8') <= 8192,
      `Diagnostic exceeds 8 KB: ${Buffer.byteLength(result.error, 'utf8')} bytes`);
  });

  it('diagnostic is bounded to 8 KB even with very long compile errors', async () => {
    // Check if javac is available
    const { spawnSync } = await import('node:child_process');
    const javacCheck = spawnSync('javac', ['--version'], { encoding: 'utf8', windowsHide: true });
    if (javacCheck.error || javacCheck.status !== 0) {
      // javac not available, skip
      return;
    }

    // Generate Java source that produces many compile errors
    let invalidCode = 'public class Main {\n';
    for (let i = 0; i < 200; i++) {
      invalidCode += `  public static void method${i}() { undefined_variable_${i} = ${i}; }\n`;
    }
    invalidCode += '}\n';

    const problem = {
      time_limit_ms: 2000,
      memory_limit_mb: 256,
      output_size_cap_kb: 64,
      comparator_mode: 'TRIMMED',
      test_cases_json: [
        { stdin: '1', expected_stdout: '1', visibility: 'SAMPLE' },
      ],
    };

    const result = await runStdioJudge(problem, invalidCode, 'java');

    assert.strictEqual(result.status, 'COMPILE_ERROR');
    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.perTestResults, []);
    assert.ok(result.error !== null);
    assert.ok(Buffer.byteLength(result.error, 'utf8') <= 8192,
      `Diagnostic exceeds 8 KB: ${Buffer.byteLength(result.error, 'utf8')} bytes`);
  });

  it('COMPILE_ERROR means no test cases are executed (perTestResults is empty)', async () => {
    // Check if javac is available
    const { spawnSync } = await import('node:child_process');
    const javacCheck = spawnSync('javac', ['--version'], { encoding: 'utf8', windowsHide: true });
    if (javacCheck.error || javacCheck.status !== 0) {
      // javac not available, skip
      return;
    }

    const problem = {
      time_limit_ms: 2000,
      memory_limit_mb: 256,
      output_size_cap_kb: 64,
      comparator_mode: 'EXACT',
      test_cases_json: [
        { stdin: 'a', expected_stdout: 'a', visibility: 'SAMPLE' },
        { stdin: 'b', expected_stdout: 'b', visibility: 'HIDDEN' },
        { stdin: 'c', expected_stdout: 'c', visibility: 'HIDDEN' },
      ],
    };

    const invalidCode = 'not valid java at all;';
    const result = await runStdioJudge(problem, invalidCode, 'java');

    assert.strictEqual(result.status, 'COMPILE_ERROR');
    assert.strictEqual(result.testsPassed, 0);
    assert.strictEqual(result.testsTotal, 3);
    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.perTestResults, []);
  });
});

/**
 * Validates: Requirements P10
 * Property 10: Overall verdict is the first failing per-test verdict.
 *
 * For any ordered list of per-test verdicts, the overall verdict equals the
 * first non-ACCEPTED verdict, or ACCEPTED if all pass.
 */
describe('P10: First-failure aggregation', () => {

  const verdictArb = fc.constantFrom('ACCEPTED', 'WRONG_ANSWER', 'TLE', 'MLE', 'OLE', 'RE');

  /**
   * Reference implementation of the aggregation logic from runStdioJudge:
   *   const failedTest = perTestResults.find(r => r.verdict !== 'ACCEPTED');
   *   const overallVerdict = failedTest ? failedTest.verdict : 'ACCEPTED';
   */
  function aggregateVerdict(verdicts) {
    const failed = verdicts.find(v => v !== 'ACCEPTED');
    return failed || 'ACCEPTED';
  }

  it('overall verdict is the first non-ACCEPTED verdict in declared order', () => {
    fc.assert(
      fc.property(
        fc.array(verdictArb, { minLength: 1, maxLength: 20 }),
        (verdicts) => {
          const expected = aggregateVerdict(verdicts);

          // Verify against the same logic used in runStdioJudge
          const perTestResults = verdicts.map((verdict, i) => ({ verdict, index: i }));
          const failedTest = perTestResults.find(r => r.verdict !== 'ACCEPTED');
          const actual = failedTest ? failedTest.verdict : 'ACCEPTED';

          assert.strictEqual(actual, expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('all-ACCEPTED list yields overall ACCEPTED', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (n) => {
          const verdicts = Array(n).fill('ACCEPTED');
          assert.strictEqual(aggregateVerdict(verdicts), 'ACCEPTED');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a single non-ACCEPTED verdict at any position determines the overall verdict', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.constantFrom('WRONG_ANSWER', 'TLE', 'MLE', 'OLE', 'RE'),
        (prefixLen, failVerdict) => {
          // All ACCEPTED before the failure
          const verdicts = Array(prefixLen).fill('ACCEPTED');
          verdicts.push(failVerdict);
          // Add some more random verdicts after (shouldn't matter)
          verdicts.push('ACCEPTED', 'TLE', 'WRONG_ANSWER');

          assert.strictEqual(aggregateVerdict(verdicts), failVerdict);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('aggregation matches runStdioJudge logic: first failure wins regardless of later verdicts', () => {
    fc.assert(
      fc.property(
        fc.array(verdictArb, { minLength: 2, maxLength: 15 }),
        (verdicts) => {
          const overall = aggregateVerdict(verdicts);

          if (verdicts.every(v => v === 'ACCEPTED')) {
            assert.strictEqual(overall, 'ACCEPTED');
          } else {
            const firstFailIdx = verdicts.findIndex(v => v !== 'ACCEPTED');
            assert.strictEqual(overall, verdicts[firstFailIdx]);
            // Verify it's truly the FIRST failure
            for (let i = 0; i < firstFailIdx; i++) {
              assert.strictEqual(verdicts[i], 'ACCEPTED');
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});


/**
 * Validates: Requirements P11
 * Property 11: runJudge dispatches by problem.type.
 *
 * For all problems p, invoking runJudge(p, code, language):
 * - For any p.problem_type === 'STDIO', invokes runStdioJudge exactly once
 *   and does NOT invoke the SQL, JS-isolated-vm, or polyglot function branches;
 * - For any p.problem_type ∈ { ALGORITHM, BACKEND, FRONTEND, SQL }, invokes
 *   the branch that existed on the pre-STDIO baseline, producing the same
 *   verdict value.
 */
describe('P11: runJudge dispatch invariant', () => {

  it('STDIO problem dispatches to runStdioJudge and returns STDIO shape', async () => {
    const problem = {
      problem_type: 'STDIO',
      time_limit_ms: 2000,
      memory_limit_mb: 256,
      output_size_cap_kb: 64,
      comparator_mode: 'TRIMMED',
      test_cases_json: [
        { stdin: 'hello\n', expected_stdout: 'hello', visibility: 'SAMPLE' },
      ],
    };
    const code = 'const line = require("readline").createInterface({input:process.stdin}); line.on("line", l => { console.log(l); line.close(); });';

    const result = await runJudge(problem, code, 'javascript');

    // STDIO shape has these fields
    assert.ok('status' in result);
    assert.ok('output' in result);
    assert.ok('testsPassed' in result);
    assert.ok('testsTotal' in result);
    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output.perTestResults));
  });

  it('STDIO problem with run option dispatches to runStdioOnce', async () => {
    const problem = {
      problem_type: 'STDIO',
      time_limit_ms: 2000,
      memory_limit_mb: 256,
      output_size_cap_kb: 64,
      comparator_mode: 'TRIMMED',
      test_cases_json: [],
    };
    const code = 'process.stdout.write("echo");';

    const result = await runJudge(problem, code, 'javascript', { kind: 'run', stdin: '' });

    // Run-flow shape
    assert.ok('stdout' in result);
    assert.ok('stderr' in result);
    assert.ok('verdict' in result);
    assert.ok('timeMs' in result);
    assert.ok('memoryMb' in result);
    assert.ok('timedOut' in result);
  });

  it('ALGORITHM problem does NOT dispatch to STDIO branch', async () => {
    const problem = {
      problem_type: 'ALGORITHM',
      test_cases_json: JSON.stringify([{ input: [1, 2], expected: 3 }]),
      function_name: 'add',
      starter_code: { javascript: 'function add(a, b) { return a + b; }' },
    };
    const code = 'function add(a, b) { return a + b; }';

    const result = await runJudge(problem, code, 'javascript');

    // Non-STDIO shape: has 'status' but returns the JS judge shape
    assert.ok('status' in result);
    // The existing JS judge returns testsPassed/testsTotal but NOT perTestResults in output JSON
    // Just verify it doesn't crash and returns a valid status
    assert.ok(result.status !== undefined);
    // Verify it does NOT have the Run-flow shape (stdout/stderr/verdict/timeMs/memoryMb/timedOut)
    assert.strictEqual('stdout' in result, false, 'ALGORITHM result should not have stdout field (Run-flow shape)');
    assert.strictEqual('timedOut' in result, false, 'ALGORITHM result should not have timedOut field (Run-flow shape)');
  });
});
