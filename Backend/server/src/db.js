import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbFile = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'skillforge.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,                      -- null for OAuth-only users
  google_id     TEXT UNIQUE,
  avatar_url    TEXT,
  full_name     TEXT,
  bio           TEXT,
  location      TEXT,
  website       TEXT,
  role          TEXT NOT NULL DEFAULT 'USER',  -- USER | ADMIN
  rating        INTEGER NOT NULL DEFAULT 1200,
  theme         TEXT NOT NULL DEFAULT 'dark',  -- dark | light
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT
);

CREATE TABLE IF NOT EXISTS problems (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  difficulty    TEXT NOT NULL DEFAULT 'EASY',   -- EASY | MEDIUM | HARD
  problem_type  TEXT NOT NULL DEFAULT 'ALGORITHM', -- ALGORITHM | SQL | BACKEND | FRONTEND
  category_id   INTEGER REFERENCES categories(id),
  tags          TEXT,                           -- comma-separated
  examples_json TEXT,                           -- JSON array of {input, output, explanation}
  constraints   TEXT,
  hints_json    TEXT,                           -- JSON array of strings
  starter_code_json TEXT,                       -- JSON {language: code}
  expected_output TEXT,                         -- expected stdout to match for naive judging (ALGORITHM)
  test_cases_json   TEXT,                       -- JSON tests for SQL/BACKEND/FRONTEND judges
  sql_setup         TEXT,                       -- DDL+DML run before each SQL submission
  function_name     TEXT,                       -- JS entry-point function name for JS judges
  time_limit_ms INTEGER NOT NULL DEFAULT 1000,
  memory_limit_mb INTEGER NOT NULL DEFAULT 256,
  is_premium    INTEGER NOT NULL DEFAULT 0,
  total_submissions INTEGER NOT NULL DEFAULT 0,
  accepted_submissions INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_problems_category ON problems(category_id);
CREATE INDEX IF NOT EXISTS idx_problems_type ON problems(problem_type);

CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  language    TEXT NOT NULL,
  code        TEXT NOT NULL,
  status      TEXT NOT NULL,        -- ACCEPTED | WRONG_ANSWER | RUNTIME_ERROR | TLE | COMPILE_ERROR | PENDING
  runtime_ms  INTEGER,
  memory_kb   INTEGER,
  tests_passed INTEGER,
  tests_total INTEGER,
  output      TEXT,
  error       TEXT,
  beats_pct   REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, problem_id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  redirect    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(schema);

// ── Lightweight in-place migrations for older DBs ───────────────────────────
function ensureColumn(table, name, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}
ensureColumn('problems', 'problem_type',     `TEXT NOT NULL DEFAULT 'ALGORITHM'`);
ensureColumn('problems', 'test_cases_json',  `TEXT`);
ensureColumn('problems', 'sql_setup',        `TEXT`);
ensureColumn('problems', 'function_name',    `TEXT`);

export default db;
