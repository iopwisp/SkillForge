/**
 * Judge worker process (per ADR 0013 §"Worker process").
 *
 * Consumes BullMQ jobs from the `skillforge.judge` queue and runs them
 * through `submissions.service.finalize(submissionId)`. Sits in its own
 * Node runtime so:
 *   - the API can restart without losing in-flight jobs;
 *   - worker memory pressure (V8 isolates, better-sqlite3 instances)
 *     does not squeeze out the request handlers;
 *   - ops can scale workers horizontally (`docker compose up --scale
 *     worker=N` or replicas in k8s).
 *
 * Importing `submissions/service.js` is what registers `finalize()` as
 * the queue's processor — that side-effect is by design (see queue.js).
 */
import 'dotenv/config';

import { logger } from './shared/logger.js';
import { runMigrations } from './shared/migrations.js';
import { captureException, initSentry, isSentryEnabled } from './shared/sentry.js';
import { shutdownQueue, startBullmqWorker } from './shared/queue.js';
import { prePullImages } from './modules/judge/container-manager.js';
import { getStdioRuntimeMode } from './modules/judge/stdio-prepare.js';

// Side-effect import: registers `finalize()` as the queue processor.
import './modules/submissions/service.js';

initSentry();

const concurrency = parseInt(process.env.JUDGE_WORKER_CONCURRENCY || '2', 10);

async function main() {
  // Workers don't *have* to run migrations — the API does that on boot —
  // but on a fresh single-machine install the worker may come up before
  // the first API process has applied them. `runMigrations` is idempotent
  // and the migration runner takes a per-installation lock, so two
  // services racing on it is safe.
  await runMigrations();

  // Pre-pull Docker images if running in Docker mode.
  // getStdioRuntimeMode() returns 'docker' when JUDGE_RUNTIME_MODE=docker,
  // or when JUDGE_RUNTIME_MODE=auto and Docker is reachable.
  // If mode is 'local' or 'off', skip pre-pull entirely.
  const runtimeMode = getStdioRuntimeMode();
  if (runtimeMode === 'docker') {
    logger.info('Pre-pulling Docker images for judge...');
    const result = await prePullImages();
    logger.info(
      { pulled: result.pulled.length, skipped: result.skipped.length, failed: result.failed.length },
      'Docker image pre-pull complete',
    );
  }

  const worker = await startBullmqWorker({ concurrency });

  logger.info(
    { concurrency, sentry: isSentryEnabled() },
    'SkillForge judge worker ready',
  );

  // ─── Graceful shutdown ──────────────────────────────────────────────────
  // BullMQ's worker.close() waits for in-flight jobs to finish (up to its
  // own internal timeout). We give it 30 s to drain before letting the
  // process exit — that's enough for any single judge call to finish.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'judge worker shutting down');
    try {
      await Promise.race([
        worker.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 30_000)),
      ]);
    } catch (e) {
      logger.warn({ err: e }, 'judge worker shutdown forced');
    } finally {
      try { await shutdownQueue(); } catch (e) {
        logger.warn({ err: e }, 'judge worker queue cleanup failed');
      }
      process.exit(0);
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'SkillForge judge worker failed to boot');
  captureException(error);
  process.exit(1);
});
