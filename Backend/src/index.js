/**
 * Application bootstrap.
 *
 * Composes the express app from the modules under `src/modules/*` and the
 * cross-cutting concerns under `src/shared/*`. Per ADR 0003 this is the
 * only place where module routers are wired together.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { db } from './shared/db.js';
import { logger } from './shared/logger.js';
import { captureException, initSentry, isSentryEnabled } from './shared/sentry.js';
import { requestId } from './shared/middleware/request-id.js';
import { removeSeededUsers, runSeed } from './shared/seed/index.js';

import authRoutes from './modules/auth/routes.js';
import categoriesRoutes from './modules/categories/routes.js';
import problemsRoutes from './modules/problems/routes.js';
import submissionsRoutes from './modules/submissions/routes.js';
import usersRoutes from './modules/users/routes.js';

initSentry();

const app = express();

// ─── Middleware ─────────────────────────────────────────────────────────────
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);

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

// Request id and per-request logger. Order: requestId() first so pino-http
// can pick up `req.id`; pino-http then attaches `req.log` (a child logger
// with reqId baked in).
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

// ─── Rate limit auth endpoints ──────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'UP', service: 'skillforge-server', version: '1.1.0', time: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/problems', problemsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/submissions', submissionsRoutes);
app.use('/api/users', usersRoutes);

// ─── Error handler ──────────────────────────────────────────────────────────
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

// ─── Boot ───────────────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '4000', 10);

const catalogExists = db.prepare(`SELECT COUNT(*) AS n FROM problems`).get().n > 0;
if (!catalogExists) {
  logger.info('Empty DB detected — running seed');
  runSeed();
}

const removedSeededUsers = removeSeededUsers();
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
