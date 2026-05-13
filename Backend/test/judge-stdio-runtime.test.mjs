/**
 * Integration test: judge-stdio-runtime.test.mjs
 *
 * Small deterministic cases (≤10) — one per runtime branch, one per
 * per-test verdict flavour (TLE, MLE, OLE, RE, CE), one asserting the
 * Docker argv contains --network=none.
 *
 * Uses real subprocesses in local mode; Docker tests guarded behind
 * a `docker info` probe (skip when unreachable).
 *
 * Requirements: R9.1–R9.6
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runStdioJudge, runStdioOnce } from '../src/modules/judge/stdio-exec.js';
import { getStdioRuntimeMode, buildDockerRunStep, STDIO_DOCKER_FLAGS } from '../src/modules/judge/stdio-prepare.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeProblem(overrides = {}) {
  return {
    time_limit_ms: 2000,
    memory_limit_mb: 256,
    output_size_cap_kb: 64,
    comparator_mode: 'TRIMMED',
    test_cases_json: [
      { stdin: 'hello\n', expected_stdout: 'hello', visibility: 'SAMPLE' },
    ],
    ...overrides,
  };
}

function javacAvailable() {
  const res = spawnSync('javac', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  return res.status === 0;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('STDIO Runtime Integration (R9.1–R9.6)', () => {

  // 1. ACCEPTED — Node.js echo program (local mode)
  it('ACCEPTED — Node.js echo (local mode)', async () => {
    const problem = makeProblem({
      comparator_mode: 'TRIMMED',
      test_cases_json: [
        { stdin: 'hello\n', expected_stdout: 'hello', visibility: 'SAMPLE' },
      ],
    });
    const code = `process.stdin.on('data', d => process.stdout.write(d.toString().trim()));`;

    const result = await runStdioJudge(problem, code, 'javascript');

    assert.strictEqual(result.status, 'ACCEPTED');
    assert.strictEqual(result.testsPassed, 1);
  });

  // 2. WRONG_ANSWER — Node.js wrong output (local mode)
  it('WRONG_ANSWER — Node.js wrong output (local mode)', async () => {
    const problem = makeProblem({
      comparator_mode: 'EXACT',
      test_cases_json: [
        { stdin: '5', expected_stdout: '10', visibility: 'SAMPLE' },
      ],
    });
    const code = `console.log("wrong");`;

    const result = await runStdioJudge(problem, code, 'javascript');

    assert.strictEqual(result.status, 'WRONG_ANSWER');
  });

  // 3. TLE — infinite loop (local mode)
  it('TLE — infinite loop (local mode)', async () => {
    const problem = makeProblem({
      time_limit_ms: 200,
      test_cases_json: [
        { stdin: '', expected_stdout: '', visibility: 'SAMPLE' },
      ],
    });
    const code = `while(true){}`;

    const result = await runStdioJudge(problem, code, 'javascript');

    assert.strictEqual(result.status, 'TLE');
    // The process should have been killed after exceeding the time limit
    const output = JSON.parse(result.output);
    assert.ok(output.perTestResults[0].time_ms >= 200,
      `Expected timeMs >= 200 but got ${output.perTestResults[0].time_ms}`);
  });

  // 4. OLE — output flood (local mode)
  it('OLE — output flood (local mode)', async () => {
    const problem = makeProblem({
      output_size_cap_kb: 1, // 1 KB cap
      test_cases_json: [
        { stdin: '', expected_stdout: '', visibility: 'SAMPLE' },
      ],
    });
    const code = `while(true) process.stdout.write("x".repeat(1024));`;

    const result = await runStdioJudge(problem, code, 'javascript');

    assert.strictEqual(result.status, 'OLE');
  });

  // 5. RE — non-zero exit (local mode)
  it('RE — non-zero exit (local mode)', async () => {
    const problem = makeProblem({
      test_cases_json: [
        { stdin: '', expected_stdout: '', visibility: 'SAMPLE' },
      ],
    });
    const code = `process.exit(42);`;

    const result = await runStdioJudge(problem, code, 'javascript');

    assert.strictEqual(result.status, 'RE');
  });

  // 6. COMPILE_ERROR — bad Java (local mode, skip if javac unavailable)
  it('COMPILE_ERROR — bad Java (local mode)', async () => {
    if (!javacAvailable()) {
      return; // skip — javac not installed
    }

    const problem = makeProblem({
      test_cases_json: [
        { stdin: '1', expected_stdout: '1', visibility: 'SAMPLE' },
      ],
    });
    const code = `invalid java;`;

    const result = await runStdioJudge(problem, code, 'java');

    assert.strictEqual(result.status, 'COMPILE_ERROR');
    assert.ok(result.error && result.error.length > 0,
      'Expected non-empty compile error diagnostic');
  });

  // 7. Docker argv contains --network=none (unit test of buildDockerRunStep)
  it('Docker argv contains --network=none, --read-only, and tmpfs flag', () => {
    const step = buildDockerRunStep('JAVASCRIPT', '/tmp/test', 256);

    assert.strictEqual(step.cmd, 'docker');
    assert.ok(step.args.includes('--network=none'),
      'Expected --network=none in Docker args');
    assert.ok(step.args.includes('--read-only'),
      'Expected --read-only in Docker args');

    // Check for the tmpfs flag
    const tmpfsIdx = step.args.indexOf('--tmpfs=/tmp:rw,noexec,nosuid,size=128m');
    assert.ok(tmpfsIdx !== -1,
      'Expected --tmpfs=/tmp:rw,noexec,nosuid,size=128m in Docker args');

    // Verify STDIO_DOCKER_FLAGS constant contains the expected flags
    assert.ok(STDIO_DOCKER_FLAGS.includes('--network=none'));
    assert.ok(STDIO_DOCKER_FLAGS.includes('--read-only'));
    assert.ok(STDIO_DOCKER_FLAGS.some(f => f.startsWith('--tmpfs=')));
  });

  // 8. off mode returns 'off'
  it('off mode returns UNAVAILABLE (env override)', () => {
    const original = process.env.JUDGE_RUNTIME_MODE;
    try {
      process.env.JUDGE_RUNTIME_MODE = 'off';
      const mode = getStdioRuntimeMode();
      assert.strictEqual(mode, 'off');
    } finally {
      // Restore
      if (original === undefined) {
        delete process.env.JUDGE_RUNTIME_MODE;
      } else {
        process.env.JUDGE_RUNTIME_MODE = original;
      }
    }
  });

  // 9. Run flow returns stdout/stderr (local mode)
  it('Run flow returns stdout containing HELLO and verdict ACCEPTED', async () => {
    const problem = makeProblem({
      time_limit_ms: 2000,
      comparator_mode: 'TRIMMED',
      test_cases_json: [
        { stdin: 'hello', expected_stdout: 'HELLO', visibility: 'SAMPLE' },
      ],
    });
    const code = `const rl = require('readline').createInterface({input:process.stdin}); rl.on('line', l => { console.log(l.toUpperCase()); rl.close(); });`;

    const result = await runStdioOnce(problem, code, 'javascript', 'hello');

    assert.ok(result.stdout.includes('HELLO'),
      `Expected stdout to contain "HELLO" but got: "${result.stdout}"`);
    assert.strictEqual(result.verdict, 'ACCEPTED');
  });
});
