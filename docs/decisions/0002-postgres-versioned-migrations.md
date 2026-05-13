# 0002 — Move from SQLite to PostgreSQL with versioned migrations

- **Status:** accepted (implemented with raw `pg`)
- **Date:** 2026-05-07

## Context

The backend used SQLite via `better-sqlite3` with an "auto-migrate
columns at runtime" strategy in `src/shared/db.js` (`ensureColumn(...)`). This was
fine for a self-contained demo, but is wrong for the new direction:

- **On-prem upgrade safety.** Each university deployment will be on a
  different version. Implicit, runtime, append-only column additions are
  irreversible, untested, and silently coexist with stale schemas. There is
  no way to detect a botched upgrade or to roll back.
- **Concurrency at exam time.** A real exam scenario has 100–500 students
  submitting simultaneously. SQLite serializes writers (one writer at a
  time, even with WAL). Submissions, gradebook updates, audit-log inserts,
  and rating recalculations will contend for the same writer lock.
- **Backups and replication.** Postgres has a mature, well-understood
  backup story (`pg_dump`, `pg_basebackup`, PITR). University IT teams know
  how to operate Postgres; SQLite-as-a-product-database is unfamiliar.
- **Future features.** Plagiarism detection, audit-log queries, gradebook
  analytics will benefit from window functions, FTS, and indexes that
  SQLite either lacks or implements with caveats.

## Decision

1. Migrate the production database from **SQLite → PostgreSQL 16**.
2. Replace runtime `ensureColumn(...)` with **versioned migration files**
   under `Backend/db/migrations/NNNN_short-name.sql` (forward-only, applied
   in numeric order at startup).
3. The schema must be expressed in plain SQL, not in an ORM-specific DSL,
   so that customers can audit it without learning our toolchain.
4. The query layer uses **node-postgres (`pg`)** — minimal, no ORM/model
   layer, full SQL control, and closest to the pre-existing handwritten
   `queries.js` style in this codebase.
5. Tests must run against a real Postgres (via `docker compose` in CI), not
   against SQLite. This eliminates the class of bugs where dialect
   differences hide in CI.

## Consequences

**Positive**
- Concurrent writers without lock contention.
- Real, auditable schema history per installation.
- Backups and DR procedures match what university IT already operates.
- Eliminates an entire class of "but it works on the dev SQLite" bugs.

**Negative**
- More moving pieces locally (developers need a Postgres container).
- CI gets slower (cold-start a database).
- Migration window of 1–2 weeks during which both backends temporarily exist.

## Migration plan (sketch)

1. Add `pg` and a minimal migration runner.
2. Translate the existing schema into `Backend/db/migrations/0001_initial.sql`.
3. Rewrite each module's queries/services/routes to async Postgres access
   while preserving ADR 0003 boundaries.
4. Update test setup and CI to run against a real Postgres service.
5. Keep `better-sqlite3` only inside the SQL judge module, where it still
   powers the in-memory per-submission database used for SQL exercises.

## Future re-evaluation

We will revisit if:
- An on-prem customer cannot run Postgres for a hard reason (none expected
  for our target market), OR
- Postgres operational cost outweighs benefits at scale (would only happen
  far past the first ~10 customers).
