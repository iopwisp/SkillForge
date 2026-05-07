import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { db } from './db.js';
import authRoutes from './routes/auth.js';
import problemsRoutes from './routes/problems.js';
import categoriesRoutes from './routes/categories.js';
import submissionsRoutes from './routes/submissions.js';
import usersRoutes from './routes/users.js';
import { removeSeededUsers, runSeed } from './seed.js';

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
      console.warn(`[cors] dev allow: origin "${origin}" not in CORS_ORIGIN allowlist`);
      return cb(null, true);
    }
    return cb(new Error(`CORS: origin "${origin}" not allowed`), false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

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
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Boot ───────────────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '4000', 10);

const catalogExists = db.prepare(`SELECT COUNT(*) AS n FROM problems`).get().n > 0;
if (!catalogExists) {
  console.log('🐘 Empty DB detected — running seed...');
  runSeed();
}

const removedSeededUsers = removeSeededUsers();
if (removedSeededUsers > 0) {
  console.log(`🧹 Removed ${removedSeededUsers} seeded accounts from the database.`);
}

app.listen(port, () => {
  console.log(`\n⚒️ SkillForge backend running at http://localhost:${port}`);
  console.log(`   API base:  http://localhost:${port}/api`);
  console.log(`   Health:    http://localhost:${port}/api/health`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.log(`   ⚠️  Google OAuth disabled — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env to enable.`);
  } else {
    console.log(`   ✅ Google OAuth enabled.`);
  }
  console.log('');
});
