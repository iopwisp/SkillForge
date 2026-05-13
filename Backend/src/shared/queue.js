/**
 * Pluggable judge queue (per ADR 0013).
 *
 * Two adapters live behind the same producer / worker API:
 *
 *   - `inline`  — calls the registered processor immediately on the same
 *     event loop. Used by tests, dev workflow without Redis, and as the
 *     default outside `NODE_ENV=production`.
 *   - `bullmq`  — produces real jobs onto a Redis-backed BullMQ queue
 *     and (in the worker process) consumes them via `Worker`. Used in
 *     production / docker-compose / load tests.
 *
 * The submissions module registers its `finalize(submissionId)` function
 * via `setJudgeJobProcessor()` at import time. The Express app stays
 * fully unaware of which adapter is wired up; the worker process
 * (`src/worker.js`) calls `startBullmqWorker(finalize)` to consume jobs.
 */
import { logger } from './logger.js';

const QUEUE_NAME = 'skillforge.judge';

function resolveMode() {
  if (process.env.NODE_ENV === 'test') return 'inline';
  const env = (process.env.JUDGE_QUEUE || '').toLowerCase();
  if (env === 'inline' || env === 'bullmq') return env;
  return process.env.NODE_ENV === 'production' ? 'bullmq' : 'inline';
}

let mode = resolveMode();

let processor = null;
let bullmqQueue = null;
let bullmqWorker = null;
let redisConnection = null;

// Singleton promises guard against concurrent lazy-init races. Without
// these, 200 parallel requests each seeing `bullmqQueue === null` would
// each create their own Queue / IORedis pair and leak connections.
let redisPromise = null;
let queuePromise = null;

/* ─── lazy bullmq setup ─────────────────────────────────────────────────── */

async function getRedis() {
  if (redisConnection) return redisConnection;
  if (redisPromise) return redisPromise;
  // Lazy import keeps `ioredis` out of the import graph when running in
  // inline mode (tests, dev) — that's important because tests should not
  // require Redis to be reachable.
  redisPromise = (async () => {
    const { default: IORedis } = await import('ioredis');
    redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      // BullMQ requires this for blocking ops.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    return redisConnection;
  })();
  return redisPromise;
}

async function getQueue() {
  if (bullmqQueue) return bullmqQueue;
  if (queuePromise) return queuePromise;
  queuePromise = (async () => {
    const { Queue } = await import('bullmq');
    bullmqQueue = new Queue(QUEUE_NAME, { connection: await getRedis() });
    return bullmqQueue;
  })();
  return queuePromise;
}

/* ─── public API ────────────────────────────────────────────────────────── */

/**
 * Register the in-process function that the inline adapter (and the
 * BullMQ worker) will call to actually run the judge for a given
 * submission id. Idempotent — last call wins.
 */
export function setJudgeJobProcessor(fn) {
  processor = fn;
}

/**
 * Producer side. Resolves once the job is durably enqueued (bullmq) or
 * once the inline processor returns (inline). In inline mode any
 * exception from the processor is *not* swallowed, so the HTTP request
 * sees a real error in the same response — that's the price of skipping
 * the queue.
 *
 * `metadata` is stashed on the BullMQ job payload alongside the
 * submission id. The worker does not need it (it re-reads the row),
 * but it keeps log entries / dashboards self-describing and gives
 * contest-mode (task 13.1) a typed channel for `contestParticipationId`.
 */
export async function enqueueJudgeJob(submissionId, metadata = {}) {
  if (mode === 'inline') {
    if (!processor) {
      throw new Error('queue: inline mode but no processor registered (did submissions/service.js load?)');
    }
    return processor(submissionId);
  }
  const queue = await getQueue();
  await queue.add('judge', { submissionId, ...metadata }, {
    // BullMQ deduplicates on jobId. A double-submit landing on the same
    // submissionId becomes a no-op rather than a re-judge — the
    // idempotency layer (Idempotency-Key header) handles user-side dup
    // detection upstream of this.
    // BullMQ rejects pure-digit jobIds and colons, so prefix with "s".
    jobId: `s${submissionId}`,
    removeOnComplete: { age: 60 * 60, count: 1000 },
    removeOnFail: { age: 24 * 60 * 60, count: 1000 },
    attempts: 1,                      // judges are deterministic; no retry
  });
}

/**
 * Worker side. Boots a BullMQ Worker that pulls jobs off the judge
 * queue and invokes the registered processor. Throws if the processor
 * has not been registered yet — call `setJudgeJobProcessor` first
 * (importing `submissions/service.js` does that as a side effect).
 *
 * Returns the Worker instance so the caller can wait on
 * `worker.close()` for graceful shutdown.
 */
export async function startBullmqWorker({ concurrency = 2 } = {}) {
  if (bullmqWorker) return bullmqWorker;
  if (!processor) {
    throw new Error('queue: cannot start worker, no processor registered');
  }
  const { Worker } = await import('bullmq');
  bullmqWorker = new Worker(QUEUE_NAME, async (job) => {
    return processor(job.data.submissionId);
  }, {
    connection: await getRedis(),
    concurrency,
  });
  bullmqWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, submissionId: job?.data?.submissionId, err },
      'judge worker job failed',
    );
  });
  bullmqWorker.on('completed', (job) => {
    logger.info(
      { jobId: job?.id, submissionId: job?.data?.submissionId },
      'judge worker job completed',
    );
  });
  return bullmqWorker;
}

/**
 * Tear down all bullmq state (connections, queues, workers).
 * Used by tests and graceful shutdown signal handlers.
 */
export async function shutdownQueue() {
  if (bullmqWorker) {
    try { await bullmqWorker.close(); } catch (e) {
      logger.warn({ err: e }, 'error closing bullmq worker');
    }
    bullmqWorker = null;
  }
  if (bullmqQueue) {
    try { await bullmqQueue.close(); } catch (e) {
      logger.warn({ err: e }, 'error closing bullmq queue');
    }
    bullmqQueue = null;
  }
  if (redisConnection) {
    try { await redisConnection.quit(); } catch (e) {
      logger.warn({ err: e }, 'error closing redis connection');
    }
    redisConnection = null;
  }
  redisPromise = null;
  queuePromise = null;
}

/** Inspectable for tests / health checks. */
export function getQueueMode() {
  return mode;
}

/**
 * Force the queue mode at runtime. Tests can use this to flip between
 * `inline` and a fake bullmq adapter without restarting the process.
 * Production code never calls this — `JUDGE_QUEUE` env decides at boot.
 */
export function _setQueueModeForTesting(next) {
  mode = next;
}
