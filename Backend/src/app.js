/**
 * Express app factory.
 *
 * `createApp()` returns a fully-wired app without touching the process
 * (no `listen`, no migrations, no seed). This is what `src/index.js`
 * mounts in production and what the integration tests in `test/*.test.mjs`
 * mount with supertest.
 *
 * Per ADR 0003 this file is the *only* place where module routers are
 * composed; nothing under `src/modules/*` imports another module's router
 * directly.
 */
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { asyncHandler } from './shared/errors.js';
import { logger } from './shared/logger.js';
import { captureException } from './shared/sentry.js';
import { requestId } from './shared/middleware/request-id.js';

import auditRoutes from './modules/audit/routes.js';
import authRoutes from './modules/auth/routes.js';
import categoriesRoutes from './modules/categories/routes.js';
import { requireAuth } from './modules/auth/middleware.js';
import contestsRoutes, {
  getUserContestHistoryHandler,
  getUserContestRatingHandler,
} from './modules/contests/routes.js';
import coursesRoutes from './modules/courses/routes.js';
import examsRoutes from './modules/exams/routes.js';
import groupsRoutes from './modules/groups/routes.js';
import problemsRoutes from './modules/problems/routes.js';
import submissionsRoutes from './modules/submissions/routes.js';
import usersRoutes from './modules/users/routes.js';

export function createApp() {
  const app = express();

  // ─── CORS ─────────────────────────────────────────────────────────────────
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(cors({
    origin(origin, cb) {
      // Same-origin / curl / server-to-server requests have no Origin header.
      if (!origin) return cb(null, true);
      if (corsOrigins.includes('*')) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      // In development, allow with a warning so a misconfigured frontend port
      // doesn't block local debugging. In production, reject hard.
      if (!isProd) {
        logger.warn({ origin }, 'CORS dev-allow: origin not in CORS_ORIGIN allowlist');
        return cb(null, true);
      }
      return cb(new Error(`CORS: origin "${origin}" not allowed`), false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // ─── Request id + per-request logger ──────────────────────────────────────
  // Order: requestId() first so pino-http can pick up `req.id`; pino-http
  // then attaches `req.log` (a child logger with reqId baked in).
  app.use(requestId());
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Health checks should not spam the logs.
    autoLogging: {
      ignore: (req) => req.url === '/api/health',
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));

  // ─── Rate limit auth endpoints ────────────────────────────────────────────
  // Tests set NODE_ENV=test and bump the ceiling so the suite doesn't trip
  // the limiter. In production the default 100 / 15m is conservative.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ─── Routes ───────────────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'UP', service: 'skillforge-server', version: '1.1.0', time: new Date().toISOString() });
  });

  app.use('/api/audit-log', auditRoutes);
  app.use('/api/contests', contestsRoutes);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/problems', problemsRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/submissions', submissionsRoutes);
  // User-scoped contest reads live in the contests module but mount under
  // /api/users/* so they sit next to the user's profile URLs. Wired here
  // (not in users/routes.js) so the contests module stays the sole owner
  // of contest-reading logic; this also avoids cross-module DB access
  // from users.service. Mounted BEFORE `usersRoutes` so that the more
  // specific paths win even if usersRoutes later grows a catchall.
  app.get('/api/users/:username/contests', requireAuth, asyncHandler(getUserContestHistoryHandler));
  app.get('/api/users/:username/contest-rating', requireAuth, asyncHandler(getUserContestRatingHandler));
  app.use('/api/users', usersRoutes);
  // Groups and exams are nested under courses: mount the more specific
  // paths BEFORE the top-level courses router so they win. Both nested
  // routers use `mergeParams: true` so `:courseSlug` is visible inside
  // their handlers.
  app.use('/api/courses/:courseSlug/groups', groupsRoutes);
  app.use('/api/courses/:courseSlug/exams', examsRoutes);
  app.use('/api/courses', coursesRoutes);

  // ─── Error handler ────────────────────────────────────────────────────────
  app.use((err, req, res, _next) => {
    // HttpError instances carry an explicit status; everything else is 500.
    const status = err.status || err.statusCode || 500;
    const log = req.log || logger;

    if (status >= 500) {
      log.error({ err }, 'unhandled server error');
      captureException(err, { req });
    } else {
      // 4xx errors are user errors. Logged at warn so they're searchable but
      // don't page anyone. The request body is included for debugging; pino's
      // redact config strips `password` etc.
      log.warn({ err: { message: err.message, status }, body: req.body }, 'client error');
    }

    if (res.headersSent) return;
    const body = { error: err.message || 'Internal Server Error' };
    if (err.details !== undefined) body.details = err.details;
    res.status(status).json(body);
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

export default createApp;
