/**
 * stdio-prepare.js — Per-language source writing + compile step for STDIO problems.
 *
 * Exports:
 *   prepare(language, problem, code, tmpdir) → { status, run?, diagnostic? }
 *   canonicalLanguage(lang) → 'JAVASCRIPT' | 'PYTHON' | 'JAVA' | 'GO' | 'CPP' | null
 *   getStdioRuntimeMode() → 'local' | 'docker' | 'off'
 *   buildDockerRunStep(language, workdir, memoryLimitMb) → { cmd, args, workdir }
 *   STDIO_DOCKER_FLAGS — constant array of Docker security flags for test assertability
 *
 * Caller is responsible for creating and cleaning up tmpdir.
 * This module never leaks file handles or child processes.
 */

import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const COMPILE_TIMEOUT_MS = 30_000;
const MAX_DIAGNOSTIC_BYTES = 8192;
const TRUNCATION_MARKER = '\n[...truncated]';
const DOCKER_PROBE_TIMEOUT_MS = 2000;

/**
 * Docker security flags applied to every STDIO Docker invocation.
 * Exported for test assertability (R9.3, R9.5).
 */
export const STDIO_DOCKER_FLAGS = ['--network=none', '--read-only', '--tmpfs=/tmp:rw,noexec,nosuid,size=128m'];

/**
 * Docker image map for STDIO languages. Mirrors the polyglot judge's image set
 * (runtimes.js) extended with CPP.
 */
const STDIO_DOCKER_IMAGES = {
  JAVASCRIPT: () => process.env.JUDGE_NODE_IMAGE || 'node:20-alpine',
  PYTHON: () => process.env.JUDGE_PYTHON_IMAGE || 'python:3.12-alpine',
  JAVA: () => process.env.JUDGE_JAVA_IMAGE || 'eclipse-temurin:21-jdk-alpine',
  GO: () => process.env.JUDGE_GO_IMAGE || 'golang:1.23-alpine',
  CPP: () => process.env.JUDGE_CPP_IMAGE || 'gcc:13-bookworm',
};

/**
 * Resolve the STDIO runtime mode from the JUDGE_RUNTIME_MODE environment variable.
 *
 * - 'off': short-circuits before any subprocess; caller returns JUDGE_ERROR.
 * - 'docker': always use Docker containers.
 * - 'local': always use local runtimes.
 * - 'auto' (default): probe Docker daemon (2 s ceiling); use Docker if available,
 *   otherwise fall back to local.
 *
 * The `auto` probe result is memoised in a module-level variable so we
 * spawn `docker info` exactly once per process — running it on every
 * submission was burning ~50–200 ms per submission on the worker hot
 * path. The cache is keyed off the resolved env value, so changing
 * `JUDGE_RUNTIME_MODE` at runtime (tests) and re-importing the module
 * still gives the right answer.
 *
 * @returns {'local' | 'docker' | 'off'}
 */
let cachedRuntimeMode = null;
let cachedRuntimeModeEnv = null;

export function getStdioRuntimeMode() {
  const envValue = (process.env.JUDGE_RUNTIME_MODE || 'auto').toLowerCase();
  if (cachedRuntimeMode !== null && cachedRuntimeModeEnv === envValue) {
    return cachedRuntimeMode;
  }

  let resolved;
  if (envValue === 'off') resolved = 'off';
  else if (envValue === 'docker') resolved = 'docker';
  else if (envValue === 'local') resolved = 'local';
  // auto: probe Docker daemon with a 2 s ceiling
  else resolved = isDockerAvailable() ? 'docker' : 'local';

  cachedRuntimeMode = resolved;
  cachedRuntimeModeEnv = envValue;
  return resolved;
}

/**
 * Test-only escape hatch — clears the memoised result so a test that
 * flips `JUDGE_RUNTIME_MODE` mid-process can pick up the new value.
 * Not used in production.
 */
export function _resetStdioRuntimeModeCache() {
  cachedRuntimeMode = null;
  cachedRuntimeModeEnv = null;
}

/**
 * Build a Docker run step for executing a STDIO submission.
 *
 * Returns a run step where cmd = 'docker' and args includes the mandatory
 * security flags (--network=none, --read-only, --tmpfs=/tmp).
 *
 * @param {string} language - Canonical language ('JAVASCRIPT' | 'PYTHON' | 'JAVA' | 'GO' | 'CPP')
 * @param {string} workdir - Host directory containing the source/binary
 * @param {number} memoryLimitMb - Memory limit for the container
 * @returns {{ cmd: string, args: string[], workdir: string }}
 */
export function buildDockerRunStep(language, workdir, memoryLimitMb) {
  const canonical = language.toUpperCase();
  const imageGetter = STDIO_DOCKER_IMAGES[canonical];
  if (!imageGetter) {
    throw new Error(`No Docker image configured for STDIO language: ${language}`);
  }
  const image = imageGetter();

  const args = [
    'run', '--rm',
    '--network=none',
    '--read-only',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=128m',
    '--memory', `${memoryLimitMb}m`,
    '-v', `${workdir}:/workspace:ro`,
    '-w', '/workspace',
    image,
  ];

  return { cmd: 'docker', args, workdir };
}

/**
 * Probe whether the Docker daemon is reachable within the 2 s ceiling.
 * Matches the polyglot judge's auto-selection behaviour (R9.3).
 */
function isDockerAvailable() {
  try {
    const result = spawnSync('docker', ['info'], {
      timeout: DOCKER_PROBE_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Normalize a language string to its canonical uppercase form.
 * Returns null for unrecognized languages.
 */
export function canonicalLanguage(lang) {
  const normalized = String(lang || '').trim().toLowerCase();
  switch (normalized) {
    case 'javascript':
    case 'js':
    case 'node':
      return 'JAVASCRIPT';
    case 'python':
    case 'python3':
    case 'py':
      return 'PYTHON';
    case 'java':
      return 'JAVA';
    case 'go':
    case 'golang':
      return 'GO';
    case 'cpp':
    case 'c++':
      return 'CPP';
    default:
      return null;
  }
}

/**
 * Prepare a submission for execution.
 *
 * Writes source into tmpdir, compiles if needed, and returns the run step.
 *
 * @param {string} language - Language identifier (normalized internally)
 * @param {object} problem - Problem object (unused for now, reserved for future use)
 * @param {string} code - Source code submitted by the student
 * @param {string} tmpdir - Already-created temporary directory path
 * @returns {Promise<{status: 'READY'|'COMPILE_ERROR'|'UNAVAILABLE', run?: {cmd: string, args: string[], workdir: string}, diagnostic?: string}>}
 *
 * Status values:
 * - `READY`: compilation (if any) succeeded; `run` contains the command to execute per test case.
 * - `COMPILE_ERROR`: compilation failed; `diagnostic` contains a bounded error message.
 * - `UNAVAILABLE`: the required runtime is not installed on this system (e.g. no local `g++`
 *    and no configured Docker image). The caller should map this to an overall `JUDGE_ERROR`
 *    verdict with the reason stored in `diagnostic`.
 */
export async function prepare(language, problem, code, tmpdir) {
  const mode = getStdioRuntimeMode();
  if (mode === 'off') {
    return { status: 'UNAVAILABLE', diagnostic: 'STDIO judging is disabled' };
  }

  const canonical = canonicalLanguage(language);

  switch (canonical) {
    case 'JAVASCRIPT':
      return prepareNode(code, tmpdir);
    case 'PYTHON':
      return preparePython(code, tmpdir);
    case 'JAVA':
      return prepareJava(code, tmpdir);
    case 'GO':
      return prepareGo(code, tmpdir);
    case 'CPP':
      return prepareCpp(code, tmpdir);
    default:
      throw new Error(`Unsupported stdio language: ${language}`);
  }
}

/**
 * JavaScript (Node): write prog.js, run with `node prog.js`.
 */
function prepareNode(code, tmpdir) {
  writeFileSync(join(tmpdir, 'prog.js'), code);
  return {
    status: 'READY',
    run: { cmd: 'node', args: ['prog.js'], workdir: tmpdir },
  };
}

/**
 * Python: write prog.py, run with `python3 prog.py`.
 */
function preparePython(code, tmpdir) {
  writeFileSync(join(tmpdir, 'prog.py'), code);
  return {
    status: 'READY',
    run: { cmd: 'python3', args: ['prog.py'], workdir: tmpdir },
  };
}

/**
 * Java: write Main.java, compile with `javac Main.java`, run with `java -cp . Main`.
 */
function prepareJava(code, tmpdir) {
  writeFileSync(join(tmpdir, 'Main.java'), code);

  const result = spawnSync('javac', ['Main.java'], {
    cwd: tmpdir,
    timeout: COMPILE_TIMEOUT_MS,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.status !== 0 || result.error) {
    const stderr = result.stderr || result.error?.message || 'Compilation failed.';
    return {
      status: 'COMPILE_ERROR',
      diagnostic: truncateDiagnostic(stderr),
    };
  }

  return {
    status: 'READY',
    run: { cmd: 'java', args: ['-cp', '.', 'Main'], workdir: tmpdir },
  };
}

/**
 * Go: write prog.go, compile with `go build -o prog prog.go`, run with `./prog`.
 */
function prepareGo(code, tmpdir) {
  writeFileSync(join(tmpdir, 'prog.go'), code);

  const outputBinary = process.platform === 'win32' ? 'prog.exe' : 'prog';

  const result = spawnSync('go', ['build', '-o', outputBinary, 'prog.go'], {
    cwd: tmpdir,
    timeout: COMPILE_TIMEOUT_MS,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.status !== 0 || result.error) {
    const stderr = result.stderr || result.error?.message || 'Compilation failed.';
    return {
      status: 'COMPILE_ERROR',
      diagnostic: truncateDiagnostic(stderr),
    };
  }

  const cmd = process.platform === 'win32' ? join(tmpdir, outputBinary) : './' + outputBinary;

  return {
    status: 'READY',
    run: { cmd, args: [], workdir: tmpdir },
  };
}

/**
 * C++: write prog.cpp, compile with `g++ -O2 -std=c++17 -pipe -o prog prog.cpp`,
 * run with `./prog`.
 *
 * Compile ONCE per submission; the caller reuses the returned `run` step across
 * every test case.
 *
 * If `g++` is not found locally (ENOENT), returns `{ status: 'UNAVAILABLE' }`
 * so the caller can map it to an overall `JUDGE_ERROR` with reason
 * "C++ runtime is not installed".
 */
function prepareCpp(code, tmpdir) {
  writeFileSync(join(tmpdir, 'prog.cpp'), code);

  const outputBinary = process.platform === 'win32' ? 'prog.exe' : 'prog';

  const result = spawnSync('g++', ['-O2', '-std=c++17', '-pipe', '-o', outputBinary, 'prog.cpp'], {
    cwd: tmpdir,
    timeout: COMPILE_TIMEOUT_MS,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.error && result.error.code === 'ENOENT') {
    return { status: 'UNAVAILABLE', diagnostic: 'C++ runtime is not installed' };
  }

  if (result.status !== 0 || result.error) {
    const stderr = result.stderr || result.error?.message || 'Compilation failed.';
    return {
      status: 'COMPILE_ERROR',
      diagnostic: truncateDiagnostic(stderr),
    };
  }

  const cmd = process.platform === 'win32' ? join(tmpdir, outputBinary) : './' + outputBinary;

  return {
    status: 'READY',
    run: { cmd, args: [], workdir: tmpdir },
  };
}

/**
 * Truncate a compile diagnostic to MAX_DIAGNOSTIC_BYTES with a truncation marker.
 */
function truncateDiagnostic(text) {
  if (text.length <= MAX_DIAGNOSTIC_BYTES) {
    return text;
  }
  return text.slice(0, MAX_DIAGNOSTIC_BYTES - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
