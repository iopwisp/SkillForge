/**
 * container-manager.js — Docker container lifecycle for per-submission isolation.
 *
 * Exports:
 *   CONTAINER_DEFAULTS — env-backed configuration with sensible fallbacks
 *   CONFIGURED_IMAGES — per-language Docker image map
 *   createContainer(opts) → ContainerHandle
 *   execInContainer(handle, cmd, execOpts) → ExecResult
 *   destroyContainer(handle) → void
 *
 * This module is only imported when JUDGE_RUNTIME_MODE is 'docker' (or 'auto'
 * with Docker available). Local mode never touches this file.
 */

import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { logger } from '../../shared/logger.js';

const execFileAsync = promisify(execFileCb);

/**
 * Configuration read from environment variables with defaults.
 */
export const CONTAINER_DEFAULTS = {
  pidsLimit: parseInt(process.env.JUDGE_DOCKER_PIDS_LIMIT || '256', 10),
  cpuLimit: parseFloat(process.env.JUDGE_DOCKER_CPU_LIMIT || '1'),
  nofileLimit: parseInt(process.env.JUDGE_DOCKER_NOFILE_LIMIT || '256', 10),
  tmpfsSizeMb: parseInt(process.env.JUDGE_DOCKER_TMPFS_SIZE_MB || '128', 10),
  compileOverheadMs: parseInt(process.env.JUDGE_DOCKER_COMPILE_OVERHEAD_MS || '30000', 10),
  seccompProfile: process.env.JUDGE_SECCOMP_PROFILE || null,
};

/**
 * Docker image map for all supported languages.
 * Each entry is a thunk so env vars are read at call time, not import time.
 */
export const CONFIGURED_IMAGES = {
  JAVASCRIPT: () => process.env.JUDGE_NODE_IMAGE || 'node:20-alpine',
  PYTHON: () => process.env.JUDGE_PYTHON_IMAGE || 'python:3.12-alpine',
  JAVA: () => process.env.JUDGE_JAVA_IMAGE || 'eclipse-temurin:21-jdk-alpine',
  GO: () => process.env.JUDGE_GO_IMAGE || 'golang:1.23-alpine',
  CPP: () => process.env.JUDGE_CPP_IMAGE || 'gcc:13-bookworm',
};

/**
 * Custom error for container start failures.
 */
export class ContainerStartError extends Error {
  constructor(message, { cause, containerName } = {}) {
    super(message);
    this.name = 'ContainerStartError';
    this.code = 'CONTAINER_START_ERROR';
    this.containerName = containerName;
    if (cause) this.cause = cause;
  }
}

/**
 * Build the `docker create` argument array for a submission container.
 * Extracted as a pure function for testability (property-based tests).
 *
 * @param {object} opts
 * @param {string} opts.name - Container name
 * @param {string} opts.image - Docker image to use
 * @param {number} opts.memoryLimitMb - Per-problem memory limit
 * @param {string} [opts.workdir] - Host-side temp directory bind-mounted at /workspace
 * @param {object} [opts.defaults] - Override CONTAINER_DEFAULTS (for testing)
 * @returns {string[]} Docker create argument array
 */
export function buildCreateArgs({ name, image, memoryLimitMb, workdir, defaults }) {
  const { pidsLimit, cpuLimit, nofileLimit, tmpfsSizeMb, seccompProfile } = defaults || CONTAINER_DEFAULTS;

  // `--read-only` makes the root filesystem read-only for defence in depth.
  // The judge needs a writable working directory where the source lands and
  // where compiled artifacts get produced and executed (Go / Java / C++).
  //
  // When a `workdir` is provided we bind-mount it at `/workspace`. This is
  // the production path — the source is prepared on the host and the
  // container gets a read-write view of exactly that one directory. We
  // use bind-mount instead of `docker cp` because cp-into-stopped-
  // containers requires a writable rootfs which conflicts with
  // `--read-only` on some daemons (notably Windows: "container rootfs
  // is marked read-only"), even when `/workspace` is covered by a tmpfs
  // mount (tmpfs mounts activate at start, cp into stopped container
  // hits the read-only rootfs check first).
  //
  // When no `workdir` is provided (property tests that only inspect the
  // flag set, unit tests, etc.) we fall back to a plain tmpfs so the
  // generated args remain runnable as-is.
  //
  // `/tmp` stays a separate tmpfs with `noexec` so scratch files can't
  // be used as a second execution surface — the compiled binary must
  // live inside `/workspace` to run.
  const args = [
    'create',
    '--name', name,
    '--network=none',
    '--read-only',
    `--tmpfs=/tmp:rw,noexec,nosuid,size=${tmpfsSizeMb}m`,
  ];

  if (workdir) {
    args.push('--mount', `type=bind,src=${workdir},dst=/workspace`);
  } else {
    args.push(`--tmpfs=/workspace:rw,exec,nosuid,size=${tmpfsSizeMb}m`);
  }

  args.push(
    `--pids-limit=${pidsLimit}`,
    `--cpus=${cpuLimit}`,
    `--memory=${memoryLimitMb}m`,
    `--ulimit`, `nofile=${nofileLimit}:${nofileLimit}`,
    '--security-opt=no-new-privileges',
  );

  if (seccompProfile) {
    args.push(`--security-opt`, `seccomp=${seccompProfile}`);
  }

  args.push('-w', '/workspace');
  args.push(image);
  args.push('tail', '-f', '/dev/null');

  return args;
}

/**
 * Generate a unique container name for a submission.
 *
 * @param {string} submissionId
 * @returns {string}
 */
export function generateContainerName(submissionId) {
  const suffix = randomBytes(3).toString('hex');
  return `sf-judge-${submissionId}-${suffix}`;
}

/**
 * Create a submission container with all hardened flags applied.
 *
 * @param {object} opts
 * @param {string} opts.image - Docker image to use
 * @param {string} opts.workdir - Host-side temp directory with source code
 * @param {number} opts.memoryLimitMb - Per-problem memory limit
 * @param {string} opts.submissionId - For naming and logging
 * @param {number} opts.timeoutMs - Per-submission timeout ceiling
 * @returns {Promise<ContainerHandle>}
 * @throws {ContainerStartError} if container fails to start
 */
export async function createContainer({ image, workdir, memoryLimitMb, submissionId, timeoutMs }) {
  const name = generateContainerName(submissionId);

  const createArgs = buildCreateArgs({ name, image, memoryLimitMb, workdir });

  const { pidsLimit, cpuLimit, nofileLimit, tmpfsSizeMb } = CONTAINER_DEFAULTS;

  logger.debug(
    { containerName: name, image, submissionId, memoryLimitMb, pidsLimit, cpuLimit, nofileLimit, tmpfsSizeMb },
    'Creating Docker container',
  );

  try {
    // Step 1: docker create (with bind-mounted /workspace, so source is
    // already visible inside the container).
    await execFileAsync('docker', createArgs);

    // Step 2: docker start. No separate `docker cp` is needed — the bind
    // mount gives the container a live view of the prepared workdir.
    await execFileAsync('docker', ['start', name]);
  } catch (err) {
    // Attempt cleanup on failure
    try {
      await execFileAsync('docker', ['rm', '-f', name]);
    } catch {
      // Ignore cleanup errors
    }
    throw new ContainerStartError(
      `Failed to start container ${name}: ${err.message}`,
      { cause: err, containerName: name },
    );
  }

  return {
    name,
    image,
    workdir,
    submissionId,
    createdAt: Date.now(),
    timeoutMs,
    timeoutTimer: null,
  };
}


/**
 * Execute a command inside a running container.
 *
 * @param {ContainerHandle} handle - From createContainer
 * @param {string[]} cmd - Command + args to exec
 * @param {object} [execOpts]
 * @param {string} [execOpts.stdin] - Data to pipe to stdin
 * @param {number} [execOpts.timeoutMs] - Per-exec wall-clock timeout
 * @param {number} [execOpts.outputCapBytes] - Max stdout bytes to capture
 * @param {string[]} [execOpts.env] - Env vars to set for the exec'd process,
 *                                    formatted as `KEY=value` strings
 * @returns {Promise<ExecResult>}
 */
export async function execInContainer(handle, cmd, execOpts = {}) {
  const { stdin, timeoutMs, outputCapBytes, env: execEnv } = execOpts;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const envArgs = (execEnv || []).flatMap((pair) => ['-e', pair]);
    const args = ['exec', '-i', ...envArgs, handle.name, ...cmd];
    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {}, // Do NOT pass host env vars
    });

    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stdoutCapped = false;

    const stderrChunks = [];
    const STDERR_CAP = 4096; // 4 KB tail

    let killedReason = null;
    let timer = null;
    let settled = false;

    function finish(exit, signal) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      const timeMs = Date.now() - startTime;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      // For stderr, keep only the last 4 KB
      const stderrBuf = Buffer.concat(stderrChunks);
      const stderr = stderrBuf.length > STDERR_CAP
        ? stderrBuf.slice(stderrBuf.length - STDERR_CAP).toString('utf8')
        : stderrBuf.toString('utf8');

      // Check OOM if exit code is 137
      if (exit === 137 && !killedReason) {
        execFileAsync('docker', ['inspect', '--format', '{{.State.OOMKilled}}', handle.name])
          .then(({ stdout: inspectOut }) => {
            const oomKilled = inspectOut.trim() === 'true';
            resolve({ stdout, stderr, exit, signal, timeMs, killedReason, oomKilled });
          })
          .catch(() => {
            // If inspect fails, assume not OOM (container may already be gone)
            resolve({ stdout, stderr, exit, signal, timeMs, killedReason, oomKilled: false });
          });
      } else {
        resolve({ stdout, stderr, exit, signal, timeMs, killedReason, oomKilled: false });
      }
    }

    child.stdout.on('data', (chunk) => {
      if (stdoutCapped) return;
      if (outputCapBytes && (stdoutBytes + chunk.length) > outputCapBytes) {
        // Take only what fits
        const remaining = outputCapBytes - stdoutBytes;
        if (remaining > 0) {
          stdoutChunks.push(chunk.slice(0, remaining));
          stdoutBytes += remaining;
        }
        stdoutCapped = true;
        killedReason = 'OLE';
        child.kill('SIGKILL');
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (_err) => {
      finish(null, null);
    });

    child.on('close', (code, sig) => {
      finish(code, sig);
    });

    // Write stdin if provided, then close
    if (stdin != null) {
      child.stdin.write(stdin, () => {
        child.stdin.end();
      });
    } else {
      child.stdin.end();
    }

    // Set up timeout
    if (timeoutMs) {
      timer = setTimeout(() => {
        if (!settled) {
          killedReason = 'TLE';
          child.kill('SIGKILL');
        }
      }, timeoutMs);
    }
  });
}

/**
 * Forcibly destroy a container and clean up the host-side temp directory.
 * Idempotent: safe to call multiple times.
 *
 * @param {ContainerHandle} handle
 * @returns {Promise<void>}
 */
export async function destroyContainer(handle) {
  // Clear the per-submission timeout timer if set
  if (handle.timeoutTimer) {
    clearTimeout(handle.timeoutTimer);
    handle.timeoutTimer = null;
  }

  const duration = Date.now() - handle.createdAt;

  // Forcibly remove the container — catch "no such container" silently
  try {
    await execFileAsync('docker', ['rm', '-f', handle.name]);
  } catch (err) {
    // "no such container" is expected if already removed — ignore
    if (!err.stderr || !err.stderr.includes('No such container')) {
      logger.debug(
        { containerName: handle.name, error: err.message },
        'Non-fatal error during container removal',
      );
    }
  }

  // Remove the host-side temp directory
  try {
    rmSync(handle.workdir, { recursive: true, force: true });
  } catch {
    // Ignore — directory may already be gone
  }

  logger.debug(
    { containerName: handle.name, submissionId: handle.submissionId, durationMs: duration },
    'Container destroyed',
  );
}


/**
 * Compute the per-submission timeout.
 * Formula: time_limit_ms * test_count * 1.5 + compile_overhead_ms
 * Clamped to [10000, 300000] ms.
 *
 * @param {number} timeLimitMs - Per-test time limit
 * @param {number} testCount - Number of test cases
 * @param {boolean} isCompiled - Whether the language requires compilation
 * @returns {number} timeout in milliseconds
 */
export function computeSubmissionTimeout(timeLimitMs, testCount, isCompiled) {
  const compileOverhead = isCompiled ? CONTAINER_DEFAULTS.compileOverheadMs : 0;
  const raw = timeLimitMs * testCount * 1.5 + compileOverhead;
  return Math.max(10000, Math.min(300000, Math.round(raw)));
}

/**
 * Start the per-submission timeout timer. When it fires, the container is
 * forcibly killed and a SubmissionTimeoutError is thrown.
 *
 * @param {object} handle - ContainerHandle from createContainer
 * @param {function} onTimeout - Callback invoked when timeout fires
 */
export function startSubmissionTimer(handle, onTimeout) {
  handle.timeoutTimer = setTimeout(async () => {
    const elapsed = Date.now() - handle.createdAt;
    logger.warn(
      { containerName: handle.name, submissionId: handle.submissionId, timeoutMs: handle.timeoutMs, elapsedMs: elapsed },
      'Per-submission timeout exceeded — killing container',
    );
    try {
      await execFileAsync('docker', ['kill', handle.name]);
    } catch { /* container may already be dead */ }
    if (onTimeout) onTimeout();
  }, handle.timeoutMs);
}

const PRE_PULL_TOTAL_CEILING_MS = 120000; // 120 seconds total

/**
 * Pre-pull all configured Docker images. Called by worker.js on startup.
 * Best-effort: logs warnings for failures, respects 120 s total ceiling.
 *
 * @returns {Promise<{ pulled: string[], skipped: string[], failed: string[] }>}
 */
export async function prePullImages() {
  const pulled = [];
  const skipped = [];
  const failed = [];
  const startTime = Date.now();

  for (const [lang, getImage] of Object.entries(CONFIGURED_IMAGES)) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= PRE_PULL_TOTAL_CEILING_MS) {
      logger.warn({ lang }, 'Pre-pull ceiling reached, skipping remaining images');
      break;
    }

    const image = getImage();
    try {
      // Check if already cached
      await execFileAsync('docker', ['image', 'inspect', image], { timeout: 5000 });
      skipped.push(image);
    } catch {
      // Not cached — pull it
      const remainingMs = PRE_PULL_TOTAL_CEILING_MS - (Date.now() - startTime);
      if (remainingMs <= 0) {
        logger.warn({ image, lang }, 'Pre-pull ceiling reached during pull');
        break;
      }
      try {
        await execFileAsync('docker', ['pull', image], { timeout: Math.min(remainingMs, 60000) });
        pulled.push(image);
      } catch (err) {
        logger.warn({ image, lang, error: err.message }, 'Failed to pull Docker image');
        failed.push(image);
      }
    }
  }

  return { pulled, skipped, failed };
}
