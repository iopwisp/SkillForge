# AGENTS.md

> Quick-start context for AI coding sessions on the SkillForge codebase.
> Read this BEFORE doing anything else when continuing work after a break.
> Last updated: 2026-05-07.

---

## 1. What this project is

**SkillForge** — a coding-practice platform aimed at being sold to
universities, starting with a pilot at AITU (Astana IT University,
Kazakhstan). Working name niche: SQL + backend + frontend tasks (not
competitive programming). Currently a working Node + SQLite SPA at
~10k LOC; being evolved into a B2B EdTech product.

The user is a solo full-time developer, currently a student at AITU,
based in Kazakhstan. Communication is in Russian; code, comments,
commit messages, and ADRs are in English.

---

## 2. Strategic context (non-negotiable inputs)

These were decided in conversation; do not relitigate them without
explicit reason.

| Decision | Value |
|---|---|
| Target market | Kazakhstan universities (AITU first, then KBTU/NU/Satbayev/KazNU) |
| Deployment model | **On-prem only** — each university hosts its own copy |
| Tenancy | **Single-tenant per installation** (no `tenant_id` column anywhere) |
| Differentiation | Real-world skills (SQL / backend / frontend), NOT LeetCode-style algorithms |
| Working mode | Solo, full-time, 3–5 months runway to AITU pilot |
| First customer | AITU as a free pilot for one semester → case study → paid customers |
| Sales horizon | Realistically 12–18 months to first paying contract |

If the user pivots any of these, the technical roadmap below changes
significantly — re-read the chat history first.

---

## 3. Tech stack

```
Backend/                        Node 20 + Express 4 + SQLite + isolated-vm
  src/
    index.js                    bootstrap (only place modules are wired)
    shared/
      db.js                     better-sqlite3 client + schema
      errors.js                 HttpError + asyncHandler
      seed/                     algorithm/backend/frontend/sql data + runSeed
    modules/
      auth/        (5 files)    routes, service, queries, schemas, middleware
      users/       (4 files)    routes, service, queries, schemas
      problems/    (3 files)    routes, service, queries
      categories/  (3 files)    routes, service, queries
      submissions/ (4 files)    routes, service, queries, schemas
      judge/       (1 file)     service.js — runSqlJudge / runJsJudge / runJudge
  eslint.config.js              boundary rules (no-restricted-imports)
  Dockerfile                    multi-stage (build for native modules)

Frontend/Frontend/              React 19 + React Router 7 (SPA) + Tailwind 4 + shadcn/ui
  app/
    routes/, components/, lib/  feature-based-ish (loaders for data)
```

Native modules (`isolated-vm`, `better-sqlite3`) compile from source on
install. Locally on Windows that needs MSVC build tools; Ubuntu CI has
gcc/g++/python3/make by default; Docker uses a multi-stage build.

---

## 4. Architectural decisions (read these, they're short)

`docs/decisions/`:

- **0001 — On-prem single-tenant.** Each university gets its own
  installation. No multi-tenancy in code.
- **0002 — Postgres + versioned migrations.** `db/migrations/NNNN_*.sql`,
  forward-only, applied at startup. (Implementation pending — currently
  still on SQLite with runtime `ensureColumn` in `shared/db.js`.)
- **0003 — Modular monolith with enforced boundaries.** Three rules:
    - `queries.js`: no cross-module imports.
    - `routes.js`: no `queries.js` (own or other), no `shared/db.js`.
    - `service.js`: no other module's `queries.js`.
  Enforced via ESLint `no-restricted-imports`. Cross-module access is
  always `service.js → other-module/service.js`.
- **0004 — `isolated-vm` for JS judge.** Phase A (in-process V8
  isolate) **shipped**. Phase B (Docker-per-submission for graded
  exams) is Phase 2 of the roadmap.

If you make another big call, write a new ADR (`docs/decisions/000N-*.md`).

---

## 5. What was done in Phase 0 so far

Three commits, in order:

1. `32f6dd3 chore(phase-0): foundation cleanup and B2B direction setup`
   - Removed Java/Spring scaffold (~14k LOC) — 9 microservices + Maven
     wrappers + multi-service docker-compose. The SPA never used them.
   - Flattened `Backend/server/*` → `Backend/`.
   - Tightened CORS: production rejects unknown origins; dev warns.
   - Added GitHub Actions CI (`.github/workflows/ci.yml`).
   - Created the four ADRs above.
2. `c2d3597 refactor(phase-0): introduce modular monolith with enforced boundaries`
   - Restructured `Backend/src/` into `modules/{auth,users,problems,categories,submissions,judge}/`
     and `shared/{db,errors,seed}`.
   - Routes throw `HttpError`; index.js error middleware maps it.
   - Async routes wrapped with `asyncHandler` (Express 4 doesn't auto-forward
     promise rejections).
   - Submissions does atomic `db.transaction()` for
     insert + problems counters + users rating bump.
   - Judge gets a unified `runJudge(problem, code, language)` facade.
   - ESLint flat config enforces module boundaries; CI runs lint.
3. `8060fa4 feat(phase-0): replace Node vm with isolated-vm for JS judge`
   - 32 MB isolate per submission, 1 s per-call wall-clock, structured-clone
     args/results, no host globals exposed.
   - 10 explicit isolation tests (`test/judge-isolation.test.mjs`) covering
     `vm` escape attempts, memory bomb, infinite loop, isolate disposal under
     load.
   - Multi-stage Dockerfile so native modules build in a stage with toolchain
     and the runtime image stays slim.

---

## 6. Phase 0 — what remains

| # | Task | Effort | Notes |
|---|---|---|---|
| 4 | Pluggable auth providers (`local` and `google` behind a common interface) | 1–2 days | Sets up later OIDC/Microsoft 365/LDAP without rewriting auth.service. |
| 5 | Pino structured logging + request-id middleware + Sentry/Glitchtip | 1 day | Without this debugging on-prem incidents will be impossible. |
| 6 | Migrate SQLite → PostgreSQL (ADR 0002), versioned migrations | 3–5 days | Biggest chunk left. Decide between Kysely / Drizzle / raw `pg` during a small spike. CI must run against a real Postgres container. |
| 7 | `docker-compose.yml` (Postgres + Backend) + `pg_dump` backup script | 0.5 day | Comes with the Postgres migration. |
| 8 | Integration tests for auth + submissions (supertest) | 1–2 days | Coverage proof for security review. |

Suggested order: 4 → 5 → 6 → 7 → 8. Rationale:
- Doing auth abstraction now keeps later SSO providers cheap.
- Logging/error tracking should be in place BEFORE the Postgres migration
  (which will surface lots of noise that needs to be observable).
- Postgres is the longest single change; keep it last in the foundation.
- Compose + backup naturally chain off the Postgres work.
- Integration tests close the loop on the new shape.

---

## 7. Roadmap beyond Phase 0

```
Phase 0  Foundation                         (4–6 weeks)   ◄─ we are here
Phase 1  University MVP                     (2–3 months)
         Roles (STUDENT/INSTRUCTOR/ADMIN), courses, groups, exams,
         instructor problem creator, gradebook + CSV, audit log.
         CONTENT TRACK in parallel: 30+ SQL, 25+ backend, 25+ frontend.
Phase 1.5 Load readiness                    (1–2 months, overlaps end of Phase 1)
         BullMQ + Redis, judge worker pool, idempotency on submit,
         smoke load test 200 concurrent. MUST FINISH BEFORE first AITU exam.
Phase 2  Pilot revenue features             (2–3 months)
         Microsoft 365 / Azure AD SSO, Winnowing plagiarism detection,
         license key, on-prem install/upgrade docs, Prometheus/Grafana.
Phase 3  Enterprise tail                    (later, after first paying customer)
         Helm chart, LTI 1.3 (Moodle/Canvas), proctoring, RU/KZ localisation,
         AI-tutor / AI code review.
```

Parallel non-technical track (run by the user, not by you):
- Find an AITU instructor for SQL/backend/web by end of Phase 0.
- Show prototype after Phase 0; get Phase 1 feature priorities from them.
- Free pilot at AITU during one semester after Phase 1.
- Use the case study to approach KBTU / NU / Satbayev / KazNU.

---

## 8. How the user works (style observed in the chat)

- Russian language for conversation; English for code and docs.
- Wants honest pushback. Don't agree just to agree. The user himself
  pushed back on parts of an earlier plan and was right about most of
  the corrections.
- Likes structured answers — tables, ranked lists, "what to do this week"
  with concrete day-by-day breakdowns.
- "Поехали" / "давай делай" / "по порядку" = green light, start working.
- Has called the assistant "Клод" once. Don't correct it.
- Wants to see verification (`npm test`, `npm run lint`, smoke HTTP)
  after each significant change — not to be told "should work".
- Does NOT want unsolicited pushes (`git push`). Commit yes, push only
  on explicit request.

---

## 9. Daily verification commands

Run these before claiming any task is done:

```bash
# Backend
cd Backend
npm run lint                 # ESLint, including module boundary rules
npm test                     # 48 reference solutions + 10 isolation tests
PORT=4099 node src/index.js  # smoke-boot; should print "running at http://localhost:4099"

# Frontend
cd Frontend/Frontend
npm run typecheck            # tsc + react-router typegen
npm run build                # vite production build
```

For end-to-end checks of cross-module flows, register a user via
`POST /api/auth/register` and submit code via
`POST /api/submissions/:slug` — verify rating bumps from 1200 to 1205
on the first ACCEPTED EASY problem.

---

## 10. Known gotchas

- **Backend/data/** is the local SQLite file plus its WAL. It is
  gitignored. Don't commit it. There's also a stale `tuskhub.db` from
  the previous codename — also gitignored, can be deleted locally.
- **`.github/java-upgrade/`** is an artifact from a prior IDE/agent
  session. Not tracked in git. Ignore it; the user can delete it.
- **Express 4 does NOT auto-forward async errors.** Wrap async route
  handlers with `asyncHandler` from `shared/errors.js`. Sync handlers
  can throw `HttpError` directly.
- **`isolated-vm` is a native module.** On Windows it usually has
  prebuilt binaries; on Linux/Alpine it builds from source (the
  multi-stage Dockerfile handles this). On a fresh `npm ci`, expect
  ~30 seconds for compilation.
- **Cross-module DB writes** go through the *other* module's
  `service.js`, never `queries.js`. ESLint will reject the latter. The
  pattern is: `submissions.service` calls `problems.service.recordSubmission`
  and `users.service.bumpRating`.
- **Schema ownership in single-tenant on-prem** is per-deployment, not
  per-tenant. If you find yourself adding `tenant_id` anywhere, stop —
  re-read ADR 0001.
- **Static seed problems** (`shared/seed/{algorithm,backend,frontend,sql}.js`)
  are bootstrap data, not a module. Tests import them directly.
- **`runJudge(problem, code, language)`** is the only entry point that
  `submissions.service` should use. Don't import `runJsJudge`/`runSqlJudge`
  outside the judge module — except for tests.
- **CI lint runs first**, so a forgotten module-boundary violation will
  block the pipeline before tests even run. Reproduce locally with
  `npm run lint`.

---

## 11. Where we are right now

The last working commit is **`8060fa4 feat(phase-0): replace Node vm
with isolated-vm for JS judge`**. Everything in Phase 0 step #2 is
finished and verified.

**Next concrete action when you next start:** Phase 0 step #4 —
pluggable auth provider abstraction. Plan:

1. Create `modules/auth/providers/` with:
    - `provider.js` (the interface, JS-doc'd: `name`, `start(req)`,
      `complete(req, res)`, both async returning `{ user }` or throwing
      `HttpError`),
    - `local.js` (wraps current register/login flow),
    - `google.js` (wraps current Google OAuth flow).
2. Refactor `modules/auth/service.js` to delegate to providers via
   `getProvider(name)`. Routes register the providers at boot.
3. Add a config table or env list (`AUTH_PROVIDERS=local,google`) so
   on-prem deployments can disable Google or add OIDC later.
4. Document the contract in a new ADR `0005-pluggable-auth.md`.
5. Update `test/` with a small auth integration smoke (register →
   login → /me → refresh).
6. Verify lint + tests + live HTTP register & google `/api/auth/google/url`.

Then commit: `feat(phase-0): pluggable auth provider abstraction`.

After that, step #5 (logging) is the next item.

---

## 12. If you find this file is wrong

Update it. This file is the source of truth for "what is the project,
what was done, what's next." If reality has drifted, fix the file in
the same commit as the change that caused the drift.
