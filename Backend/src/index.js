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

initSentry();

const app = createApp();

const port = parseInt(process.env.PORT || '4000', 10);

async function main() {
  await runMigrations();

  // Bind on 0.0.0.0 explicitly so Render's TCP probe finds the port
  // immediately. Express's default host depends on the Node version and
  // some Alpine builds resolve "localhost" to ::1 only, which Render's
  // health checker can't reach. Listening on 0.0.0.0 is unambiguous.
  app.listen(port, '0.0.0.0', () => {
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

main().catch((error) => {
  logger.fatal({ err: error }, 'SkillForge backend failed to boot');
  captureException(error);
  process.exit(1);
});
