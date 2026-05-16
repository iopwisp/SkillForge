/**
 * Production bootstrap.
 *
 * Runs migrations, optionally seeds the catalog, initialises the Sentry SDK
 * (no-op when SENTRY_DSN is not set), and starts listening.
 *
 * The actual Express app is defined in `src/app.js` so integration tests
 * can mount it with supertest without touching the filesystem or the
 * network.
 */
import 'dotenv/config';

import { createApp } from './app.js';
import { db } from './shared/db.js';
import { logger } from './shared/logger.js';
import { runMigrations } from './shared/migrations.js';
import { captureException, initSentry, isSentryEnabled } from './shared/sentry.js';
import { removeSeededUsers, runSeed } from './shared/seed/index.js';
import { sweepExpiredOAuthStates } from './modules/auth/service.js';

initSentry();

const app = createApp();

const port = parseInt(process.env.PORT || '4000', 10);

// Hourly sweep interval for expired oauth_states rows. Held at module
// scope so the SIGTERM handler can clear it on shutdown.
const ONE_HOUR_MS = 60 * 60 * 1000;
let oauthSweepTimer = null;
let httpServer = null;

async function main() {
  await runMigrations();

  // Bind on 0.0.0.0 explicitly so Render's TCP probe finds the port
  // immediately. Express's default host depends on the Node version and
  // some Alpine builds resolve "localhost" to ::1 only, which Render's
  // health checker can't reach. Listening on 0.0.0.0 is unambiguous.
  httpServer = app.listen(port, '0.0.0.0', () => {
    logger.info(
      {
        port,
        api: `http://localhost:${port}/api`,
        health: `http://localhost:${port}/api/health`,
        googleOAuth: !!process.env.GOOGLE_CLIENT_ID,
        microsoftOAuth: !!process.env.MICROSOFT_CLIENT_ID,
        sentry: isSentryEnabled(),
      },
      'SkillForge backend ready',
    );
  });

  registerShutdownHandlers();

  // Seed and one-off cleanup tasks run AFTER the HTTP server is up.
  // Otherwise on a cold first deploy with an empty DB, runSeed() can
  // take 30–60 seconds and Render's health probe times out before we
  // ever bind the port, which manifests as a generic SIGTERM with no
  // useful log line.
  //
  // The /api/health endpoint is intentionally kept stateless so it
  // returns 200 even while seeding is in progress.
  void postBootTasks().catch((err) => {
    logger.error({ err }, 'Post-boot tasks failed');
    captureException(err);
  });

  // Sweep expired OAuth state rows once per hour. Without this the
  // table grows unboundedly on a long-running deployment because the
  // happy-path callback already deletes the row on success but failed
  // / abandoned login attempts leave their state row behind.
  oauthSweepTimer = setInterval(() => {
    void sweepExpiredOAuthStates()
      .then((removed) => {
        if (removed > 0) {
          logger.info({ removed }, 'Swept expired oauth_states rows');
        }
      })
      .catch((err) => logger.warn({ err }, 'oauth_states sweep failed'));
  }, ONE_HOUR_MS);
  // Don't keep the event loop alive solely on this timer.
  if (oauthSweepTimer.unref) oauthSweepTimer.unref();
}

async function postBootTasks() {
  const catalogExists = Number(await db.value(`SELECT COUNT(*)::int AS n FROM problems`, [], 'n')) > 0;
  if (!catalogExists) {
    logger.info('Empty DB detected — running seed');
    await runSeed();
  }

  const removedSeededUsers = await removeSeededUsers();
  if (removedSeededUsers > 0) {
    logger.info({ removed: removedSeededUsers }, 'Removed seeded accounts from the database');
  }
}

/**
 * Stop accepting new connections, drain in-flight requests, then close
 * the database pool. SIGTERM is what Render / Kubernetes / docker
 * compose down send; SIGINT is Ctrl-C in dev. We give the HTTP server
 * 25 seconds to drain — Render's default kill window is 30 s, which
 * leaves us a margin to actually call `db.close()`.
 */
function registerShutdownHandlers() {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    if (oauthSweepTimer) clearInterval(oauthSweepTimer);

    const done = (err) => {
      if (err) logger.warn({ err }, 'Error during shutdown');
      db.close()
        .catch((closeErr) => logger.warn({ err: closeErr }, 'pg pool close failed'))
        .finally(() => process.exit(err ? 1 : 0));
    };

    const forceTimer = setTimeout(() => {
      logger.warn('Force-exit after 25 s drain timeout');
      done(new Error('drain timeout'));
    }, 25_000);
    if (forceTimer.unref) forceTimer.unref();

    if (httpServer) {
      httpServer.close((err) => {
        clearTimeout(forceTimer);
        done(err);
      });
    } else {
      clearTimeout(forceTimer);
      done();
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'SkillForge backend failed to boot');
  captureException(error);
  process.exit(1);
});
