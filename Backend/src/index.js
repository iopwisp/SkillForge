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

  const catalogExists = Number(await db.value(`SELECT COUNT(*)::int AS n FROM problems`, [], 'n')) > 0;
  if (!catalogExists) {
    logger.info('Empty DB detected — running seed');
    await runSeed();
  }

  const removedSeededUsers = await removeSeededUsers();
  if (removedSeededUsers > 0) {
    logger.info({ removed: removedSeededUsers }, 'Removed seeded accounts from the database');
  }

  app.listen(port, () => {
    logger.info(
      {
        port,
        api: `http://localhost:${port}/api`,
        health: `http://localhost:${port}/api/health`,
        googleOAuth: !!process.env.GOOGLE_CLIENT_ID,
        sentry: isSentryEnabled(),
      },
      'SkillForge backend ready',
    );
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'SkillForge backend failed to boot');
  captureException(error);
  process.exit(1);
});
