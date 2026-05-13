/**
 * stdio-exec.js — Per-test-case subprocess execution with resource limits.
 *
 * Exports:
 *   execOneTest({ runStep, stdin, timeLimitMs, memoryLimitMb, outputSizeCapKb })
 *     → Promise<{ stdout, stderr, timeMs, memoryMb, exit, signal, killedReason }>
 *
 * Enforces:
 *   - Wall-clock timeout: SIGKILL at 1.5 × timeLimitMs.
 *   - Peak RSS cap: polled at ≤20 ms cadence; SIGKILL on overshoot.
 *   - Output size cap: stop capturing + SIGKILL when stdout exceeds cap.
 *   - Stderr tail: keeps only the last 4 KB of stderr.
 *
 * This module never leaks child processes or timers — all cleanup happens
 * in the `close` / `error` handlers unconditionally.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareStdio } from './stdio-comparator.js';
import { prepare, getStdioRuntimeMode, canonicalLanguage } from './stdio-prepare.js';
import {
  createContainer, execInContainer, destroyContainer,
  computeSubmissionTimeout, startSubmissionTimer,
  CONFIGURED_IMAGES, CONTAINER_DEFAULTS,
} from './container-manager.js';

const STDERR_TAIL_BYTES = 4096;
const RSS_POLL_INTERVAL_MS = 20;

/**
 * Execute a single test case for an STDIO problem.
 *
 * @param {{ cmd: string, args: string[], workdir: string }} runStep
 * @param {string} stdin - Input to pipe to the child's stdin
 * @param {number} timeLimitMs - Wall-clock timeout per test case
 * @param {number} memoryLimitMb - Peak RSS cap
 * @param {number} outputSizeCapKb - Max stdout bytes to capture
 * @returns {Promise<{ stdout: string, stderr: string, timeMs: number, memoryMb: number, exit: number|null, signal: string|null, killedReason: 'TLE'|'MLE'|'OLE'|null }>}
 */
export function execOneTest({ runStep, stdin, timeLimitMs, memoryLimitMb, outputSizeCapKb }) {
  return new Promise((resolve) => {
    const outputCapBytes = outputSizeCapKb * 1024;
    const startTime = Date.now();
    let killedReason = null;
    let stdoutBytes = 0;
    const stdoutChunks = [];
    let stderrBuf = Buffer.alloc(0);
    let peakMemoryMb = 0;
    let killed = false;

    const child = spawn(runStep.cmd, runStep.args, {
      cwd: runStep.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Write stdin and close
    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();

    // Capture stdout with byte cap
    child.stdout.on('data', (chunk) => {
      if (killed) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > outputCapBytes) {
        // Only keep bytes up to the cap
        const overflow = stdoutBytes - outputCapBytes;
        const kept = chunk.slice(0, chunk.length - overflow);
        if (kept.length > 0) {
          stdoutChunks.push(kept);
        }
        killedReason = killedReason || 'OLE';
        killChild();
      } else {
        stdoutChunks.push(chunk);
      }
    });

    // Capture stderr tail (keep last 4 KB)
    child.stderr.on('data', (chunk) => {
      stderrBuf = Buffer.concat([stderrBuf, chunk]);
      if (stderrBuf.length > STDERR_TAIL_BYTES) {
        stderrBuf = stderrBuf.slice(stderrBuf.length - STDERR_TAIL_BYTES);
      }
    });

    // Wall-clock timer: SIGKILL at 1.5 × timeLimitMs
    const hardTimeout = Math.ceil(timeLimitMs * 1.5);
    const tleTimer = setTimeout(() => {
      if (!killed) {
        killedReason = killedReason || 'TLE';
        killChild();
      }
    }, hardTimeout);

    // RSS poller at ≤20 ms cadence
    const rssPoller = setInterval(() => {
      if (killed || child.exitCode !== null) return;
      try {
        const rss = getChildRssMb(child.pid);
        if (rss !== null && rss > peakMemoryMb) {
          peakMemoryMb = rss;
        }
        if (rss !== null && rss > memoryLimitMb) {
          killedReason = killedReason || 'MLE';
          killChild();
        }
      } catch {
        // Ignore — process may have already exited
      }
    }, RSS_POLL_INTERVAL_MS);

    function killChild() {
      if (killed) return;
      killed = true;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }

    child.on('close', (code, signal) => {
      clearTimeout(tleTimer);
      clearInterval(rssPoller);

      const timeMs = Date.now() - startTime;

      // Check TLE by elapsed time even if the process exited on its own
      if (!killedReason && timeMs > timeLimitMs) {
        killedReason = 'TLE';
      }

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: stderrBuf.toString('utf8'),
        timeMs,
        memoryMb: peakMemoryMb,
        exit: code,
        signal: signal || null,
        killedReason,
      });
    });

    // Handle spawn errors (e.g., ENOENT)
    child.on('error', (err) => {
      clearTimeout(tleTimer);
      clearInterval(rssPoller);
      killed = true;
      resolve({
        stdout: '',
        stderr: err.message,
        timeMs: Date.now() - startTime,
        memoryMb: 0,
        exit: -1,
        signal: null,
        killedReason: null,
      });
    });
  });
}

/**
 * Get the RSS of a child process in MB.
 * On Linux, reads /proc/<pid>/status VmRSS.
 * On other platforms, returns null (best-effort; documented limitation).
 */
function getChildRssMb(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
    if (match) return parseInt(match[1], 10) / 1024;
    return null;
  } catch {
    return null;
  }
}

/**
 * Classify a single test-case execution result into a per-test verdict.
 *
 * Precedence (highest to lowest):
 *   OLE > TLE > MLE > RE > WRONG_ANSWER > ACCEPTED
 *
 * @param {object} params
 * @param {object} params.exec - Result from execOneTest
 * @param {object} params.tc - Test case { stdin, expected_stdout, visibility }
 * @param {string} params.comparatorMode - 'EXACT' | 'TRIMMED' | 'WHITESPACE_NORMALIZED'
 * @param {object} params.limits - { timeLimitMs, memoryLimitMb, outputSizeCapKb }
 * @param {number} params.index - Test case index (0-based)
 * @returns {{ index, verdict, time_ms, memory_mb, stdout_bytes, visibility, stderr_tail, actual_output? }}
 */
export function classify({ exec, tc, comparatorMode, limits, index }) {
  const base = {
    index,
    time_ms: exec.timeMs,
    memory_mb: exec.memoryMb,
    stdout_bytes: Buffer.byteLength(exec.stdout, 'utf8'),
    visibility: tc.visibility,
    stderr_tail: exec.stderr,
  };

  // OLE — output limit exceeded (highest precedence)
  if (exec.killedReason === 'OLE' || base.stdout_bytes > limits.outputSizeCapKb * 1024) {
    return { ...base, verdict: 'OLE' };
  }

  // TLE — time limit exceeded
  if (exec.killedReason === 'TLE' || exec.timeMs > limits.timeLimitMs) {
    return { ...base, verdict: 'TLE' };
  }

  // MLE — memory limit exceeded
  if (exec.killedReason === 'MLE' || exec.memoryMb > limits.memoryLimitMb) {
    return { ...base, verdict: 'MLE' };
  }

  // RE — runtime error (non-zero exit or unexpected signal)
  if (exec.exit !== 0 || (exec.signal && exec.signal !== 'SIGKILL')) {
    return { ...base, verdict: 'RE' };
  }

  // Compare output — only reached when no limit/runtime flag flipped
  const match = compareStdio(comparatorMode, exec.stdout, tc.expected_stdout);
  if (!match) {
    const result = { ...base, verdict: 'WRONG_ANSWER' };
    // Include actual_output only for SAMPLE failures (Requirement 8.4)
    if (tc.visibility === 'SAMPLE') {
      result.actual_output = exec.stdout;
    }
    return result;
  }

  return { ...base, verdict: 'ACCEPTED' };
}


/**
 * Run a single STDIO execution for the non-persisted Run flow.
 * No iteration over test cases, no persistence, no output comparison.
 *
 * @param {object} problem - Problem row
 * @param {string} code - Student source code
 * @param {string} language - Language identifier
 * @param {string} stdin - Custom stdin provided by the student
 * @returns {Promise<{ stdout: string, stderr: string, verdict: string, timeMs: number, memoryMb: number, timedOut: boolean }>}
 */
export async function runStdioOnce(problem, code, language, stdin) {
  const mode = getStdioRuntimeMode();

  if (mode === 'docker') {
    return runStdioOnceDocker(problem, code, language, stdin);
  }

  return runStdioOnceLocal(problem, code, language, stdin);
}

/**
 * Local-mode implementation of runStdioOnce (unchanged from original).
 */
async function runStdioOnceLocal(problem, code, language, stdin) {
  const workdir = mkdtempSync(join(tmpdir(), 'stdio-run-'));

  try {
    const prepared = await prepare(language, problem, code, workdir);

    if (prepared.status === 'UNAVAILABLE') {
      return { stdout: '', stderr: prepared.diagnostic || 'Runtime is not installed', verdict: 'JUDGE_ERROR', timeMs: 0, memoryMb: 0, timedOut: false };
    }

    if (prepared.status === 'COMPILE_ERROR') {
      return { stdout: '', stderr: prepared.diagnostic, verdict: 'COMPILE_ERROR', timeMs: 0, memoryMb: 0, timedOut: false };
    }

    const exec = await execOneTest({
      runStep: prepared.run,
      stdin: stdin || '',
      timeLimitMs: problem.time_limit_ms,
      memoryLimitMb: problem.memory_limit_mb,
      outputSizeCapKb: problem.output_size_cap_kb,
    });

    // Determine verdict (no output comparison for Run flow)
    let verdict = 'ACCEPTED';
    if (exec.killedReason === 'OLE') verdict = 'OLE';
    else if (exec.killedReason === 'TLE' || exec.timeMs > problem.time_limit_ms) verdict = 'TLE';
    else if (exec.killedReason === 'MLE') verdict = 'MLE';
    else if (exec.exit !== 0 || (exec.signal && exec.signal !== 'SIGKILL')) verdict = 'RE';

    return {
      stdout: exec.stdout,
      stderr: exec.stderr,
      verdict,
      timeMs: exec.timeMs,
      memoryMb: exec.memoryMb,
      timedOut: verdict === 'TLE',
    };
  } finally {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Docker-mode implementation of runStdioOnce.
 * Uses container-manager for a single Run execution.
 */
async function runStdioOnceDocker(problem, code, language, stdin) {
  const workdir = mkdtempSync(join(tmpdir(), 'stdio-run-'));
  const canonical = canonicalLanguage(language);
  if (!canonical) {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { stdout: '', stderr: `Unsupported language: ${language}`, verdict: 'JUDGE_ERROR', timeMs: 0, memoryMb: 0, timedOut: false };
  }

  writeSourceFile(canonical, code, workdir);

  const image = CONFIGURED_IMAGES[canonical]();
  const timeout = computeSubmissionTimeout(
    problem.time_limit_ms,
    1,
    isCompiledLanguage(canonical),
  );

  let handle;
  try {
    handle = await createContainer({
      image,
      workdir,
      memoryLimitMb: problem.memory_limit_mb,
      submissionId: String(problem.id || 'run'),
      timeoutMs: timeout,
    });

    // Compile step (if needed)
    const compileCmd = getCompileCmd(canonical);
    if (compileCmd) {
      const compileResult = await execInContainer(handle, compileCmd, {
        timeoutMs: CONTAINER_DEFAULTS.compileOverheadMs,
      });
      if (compileResult.exit !== 0) {
        return { stdout: '', stderr: compileResult.stderr.slice(0, 8192), verdict: 'COMPILE_ERROR', timeMs: 0, memoryMb: 0, timedOut: false };
      }
    }

    // Run
    const runCmd = getRunCmd(canonical);
    const exec = await execInContainer(handle, runCmd, {
      stdin: stdin || '',
      timeoutMs: Math.ceil(problem.time_limit_ms * 1.5),
      outputCapBytes: problem.output_size_cap_kb * 1024,
    });

    // Determine verdict
    let verdict = 'ACCEPTED';
    if (exec.killedReason === 'OLE') verdict = 'OLE';
    else if (exec.killedReason === 'TLE' || exec.timeMs > problem.time_limit_ms) verdict = 'TLE';
    else if (exec.oomKilled || exec.exit === 137) verdict = 'MLE';
    else if (exec.exit !== 0 || (exec.signal && exec.signal !== 'SIGKILL')) verdict = 'RE';

    return {
      stdout: exec.stdout,
      stderr: exec.stderr,
      verdict,
      timeMs: exec.timeMs,
      memoryMb: exec.oomKilled ? problem.memory_limit_mb + 1 : 0,
      timedOut: verdict === 'TLE',
    };
  } catch (err) {
    if (err.code === 'CONTAINER_START_ERROR') {
      return { stdout: '', stderr: err.message, verdict: 'JUDGE_ERROR', timeMs: 0, memoryMb: 0, timedOut: false };
    }
    return { stdout: '', stderr: err.message || 'Unknown error', verdict: 'JUDGE_ERROR', timeMs: 0, memoryMb: 0, timedOut: false };
  } finally {
    if (handle) await destroyContainer(handle);
  }
}


/**
 * Run the full STDIO judge pipeline for a submission.
 *
 * @param {object} problem - Problem row with test_cases_json, time_limit_ms, memory_limit_mb, output_size_cap_kb, comparator_mode
 * @param {string} code - Student source code
 * @param {string} language - Language identifier
 * @returns {Promise<{ status, runtimeMs, memoryKb, testsPassed, testsTotal, output, error, beats }>}
 */
export async function runStdioJudge(problem, code, language) {
  const mode = getStdioRuntimeMode();

  if (mode === 'docker') {
    return runStdioJudgeDocker(problem, code, language);
  }

  // Existing local-mode code (unchanged)
  return runStdioJudgeLocal(problem, code, language);
}

/**
 * Local-mode implementation of runStdioJudge (unchanged from original).
 */
async function runStdioJudgeLocal(problem, code, language) {
  const workdir = mkdtempSync(join(tmpdir(), 'stdio-judge-'));

  try {
    // 1. Prepare (compile if needed)
    const prepared = await prepare(language, problem, code, workdir);

    if (prepared.status === 'UNAVAILABLE') {
      return {
        status: 'JUDGE_ERROR',
        runtimeMs: 0,
        memoryKb: 0,
        testsPassed: 0,
        testsTotal: problem.test_cases_json.length,
        output: JSON.stringify({ perTestResults: [] }),
        error: prepared.diagnostic || 'Runtime is not installed',
        beats: null,
      };
    }

    if (prepared.status === 'COMPILE_ERROR') {
      return {
        status: 'COMPILE_ERROR',
        runtimeMs: 0,
        memoryKb: 0,
        testsPassed: 0,
        testsTotal: problem.test_cases_json.length,
        output: JSON.stringify({ perTestResults: [] }),
        error: prepared.diagnostic,
        beats: null,
      };
    }

    // 2. Run test cases in declared order, stop on first failure
    const testCases = problem.test_cases_json;
    const perTestResults = [];
    let maxTimeMs = 0;
    let maxMemoryMb = 0;
    let testsPassed = 0;

    const limits = {
      timeLimitMs: problem.time_limit_ms,
      memoryLimitMb: problem.memory_limit_mb,
      outputSizeCapKb: problem.output_size_cap_kb,
    };

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];

      const exec = await execOneTest({
        runStep: prepared.run,
        stdin: tc.stdin,
        timeLimitMs: limits.timeLimitMs,
        memoryLimitMb: limits.memoryLimitMb,
        outputSizeCapKb: limits.outputSizeCapKb,
      });

      const perTest = classify({
        exec,
        tc,
        comparatorMode: problem.comparator_mode,
        limits,
        index: i,
      });

      perTestResults.push(perTest);

      if (exec.timeMs > maxTimeMs) maxTimeMs = exec.timeMs;
      if (exec.memoryMb > maxMemoryMb) maxMemoryMb = exec.memoryMb;

      if (perTest.verdict === 'ACCEPTED') {
        testsPassed++;
      } else {
        break; // Contest semantics: stop on first failure
      }
    }

    // 3. Determine overall verdict
    const failedTest = perTestResults.find(r => r.verdict !== 'ACCEPTED');
    const overallVerdict = failedTest ? failedTest.verdict : 'ACCEPTED';

    return {
      status: overallVerdict,
      runtimeMs: maxTimeMs,
      memoryKb: Math.round(maxMemoryMb * 1024),
      testsPassed,
      testsTotal: testCases.length,
      output: JSON.stringify({ perTestResults }),
      error: null,
      beats: null,
    };
  } finally {
    // Always clean up the temp directory
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Docker-mode implementation of runStdioJudge.
 * Uses container-manager for per-submission container lifecycle.
 */
async function runStdioJudgeDocker(problem, code, language) {
  const workdir = mkdtempSync(join(tmpdir(), 'stdio-judge-'));
  const canonical = canonicalLanguage(language);
  if (!canonical) {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
    return {
      status: 'JUDGE_ERROR',
      runtimeMs: 0,
      memoryKb: 0,
      testsPassed: 0,
      testsTotal: problem.test_cases_json.length,
      output: JSON.stringify({ perTestResults: [] }),
      error: `Unsupported language: ${language}`,
      beats: null,
    };
  }

  writeSourceFile(canonical, code, workdir);

  const image = CONFIGURED_IMAGES[canonical]();
  const timeout = computeSubmissionTimeout(
    problem.time_limit_ms,
    problem.test_cases_json.length,
    isCompiledLanguage(canonical),
  );

  let handle;
  try {
    handle = await createContainer({
      image,
      workdir,
      memoryLimitMb: problem.memory_limit_mb,
      submissionId: String(problem.id || 'stdio'),
      timeoutMs: timeout,
    });

    // Start per-submission timeout
    let timedOut = false;
    startSubmissionTimer(handle, () => { timedOut = true; });

    // Compile step (if needed)
    const compileCmd = getCompileCmd(canonical);
    if (compileCmd) {
      const compileResult = await execInContainer(handle, compileCmd, {
        timeoutMs: CONTAINER_DEFAULTS.compileOverheadMs,
      });
      if (compileResult.exit !== 0) {
        return {
          status: 'COMPILE_ERROR',
          runtimeMs: 0,
          memoryKb: 0,
          testsPassed: 0,
          testsTotal: problem.test_cases_json.length,
          output: JSON.stringify({ perTestResults: [] }),
          error: compileResult.stderr.slice(0, 8192),
          beats: null,
        };
      }
    }

    // Run test cases
    const perTestResults = [];
    let maxTimeMs = 0;
    let maxMemoryMb = 0;
    let testsPassed = 0;
    const runCmd = getRunCmd(canonical);

    for (let i = 0; i < problem.test_cases_json.length; i++) {
      if (timedOut) break;
      const tc = problem.test_cases_json[i];

      const exec = await execInContainer(handle, runCmd, {
        stdin: tc.stdin,
        timeoutMs: Math.ceil(problem.time_limit_ms * 1.5),
        outputCapBytes: problem.output_size_cap_kb * 1024,
      });

      // Map oomKilled to MLE
      const mappedExec = {
        ...exec,
        stdout: exec.stdout,
        stderr: exec.stderr,
        timeMs: exec.timeMs,
        memoryMb: exec.oomKilled ? problem.memory_limit_mb + 1 : 0,
        exit: exec.exit,
        signal: exec.signal,
        killedReason: exec.oomKilled ? 'MLE' : exec.killedReason,
      };

      const perTest = classify({
        exec: mappedExec,
        tc,
        comparatorMode: problem.comparator_mode,
        limits: { timeLimitMs: problem.time_limit_ms, memoryLimitMb: problem.memory_limit_mb, outputSizeCapKb: problem.output_size_cap_kb },
        index: i,
      });

      perTestResults.push(perTest);
      if (exec.timeMs > maxTimeMs) maxTimeMs = exec.timeMs;
      if (mappedExec.memoryMb > maxMemoryMb) maxMemoryMb = mappedExec.memoryMb;
      if (perTest.verdict === 'ACCEPTED') testsPassed++;
      else break;
    }

    if (timedOut && perTestResults.length === 0) {
      return {
        status: 'TLE',
        runtimeMs: timeout,
        memoryKb: 0,
        testsPassed: 0,
        testsTotal: problem.test_cases_json.length,
        output: JSON.stringify({ perTestResults: [] }),
        error: 'Submission exceeded aggregate time budget',
        beats: null,
      };
    }

    const failedTest = perTestResults.find(r => r.verdict !== 'ACCEPTED');
    const overallVerdict = failedTest ? failedTest.verdict : 'ACCEPTED';

    return {
      status: overallVerdict,
      runtimeMs: maxTimeMs,
      memoryKb: Math.round(maxMemoryMb * 1024),
      testsPassed,
      testsTotal: problem.test_cases_json.length,
      output: JSON.stringify({ perTestResults }),
      error: null,
      beats: null,
    };
  } catch (err) {
    if (err.code === 'CONTAINER_START_ERROR') {
      return {
        status: 'JUDGE_ERROR',
        runtimeMs: 0,
        memoryKb: 0,
        testsPassed: 0,
        testsTotal: problem.test_cases_json.length,
        output: JSON.stringify({ perTestResults: [] }),
        error: err.message,
        beats: null,
      };
    }
    return {
      status: 'JUDGE_ERROR',
      runtimeMs: 0,
      memoryKb: 0,
      testsPassed: 0,
      testsTotal: problem.test_cases_json.length,
      output: JSON.stringify({ perTestResults: [] }),
      error: err.message || 'Unknown judge error',
      beats: null,
    };
  } finally {
    if (handle) await destroyContainer(handle);
  }
}

// --- Docker-mode helper functions ---

/**
 * Check if a canonical language requires compilation.
 */
function isCompiledLanguage(canonical) {
  return ['JAVA', 'GO', 'CPP'].includes(canonical);
}

/**
 * Write the source file to the workdir and return the filename.
 */
function writeSourceFile(canonical, code, workdir) {
  const filenames = { JAVASCRIPT: 'prog.js', PYTHON: 'prog.py', JAVA: 'Main.java', GO: 'prog.go', CPP: 'prog.cpp' };
  const filename = filenames[canonical];
  writeFileSync(join(workdir, filename), code);
  return filename;
}

/**
 * Get the compile command for a language, or null if interpreted.
 */
function getCompileCmd(canonical) {
  switch (canonical) {
    case 'JAVA': return ['javac', 'Main.java'];
    case 'GO': return ['go', 'build', '-o', 'prog', 'prog.go'];
    case 'CPP': return ['g++', '-O2', '-std=c++17', '-pipe', '-o', 'prog', 'prog.cpp'];
    default: return null;
  }
}

/**
 * Get the run command for a language.
 */
function getRunCmd(canonical) {
  switch (canonical) {
    case 'JAVASCRIPT': return ['node', 'prog.js'];
    case 'PYTHON': return ['python3', 'prog.py'];
    case 'JAVA': return ['java', '-cp', '.', 'Main'];
    case 'GO': return ['./prog'];
    case 'CPP': return ['./prog'];
    default: return ['node', 'prog.js'];
  }
}
