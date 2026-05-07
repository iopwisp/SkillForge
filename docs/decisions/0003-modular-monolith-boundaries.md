# 0003 — Modular monolith with enforced module boundaries

- **Status:** accepted (implementation pending)
- **Date:** 2026-05-07

## Context

The backend will grow significantly during Phase 1 (B2B MVP):
courses, enrollments, assignments, exams, gradebook, audit log, instructor
workflows. Today the code is small enough (~2000 LOC) that everything works
out of `src/routes/*.js` calling `db` directly. Without intervention,
Phase 1 will land 5–10k more LOC and the code will become a single tangle.

Two extremes were considered:

1. **Keep flat structure, refactor later.** Cheap now, expensive later.
   Routes calling `db` from anywhere makes it impossible to enforce
   business invariants (e.g., "you cannot grade a submission without
   creating an audit_event").
2. **Full enterprise layering** (Controller → Service → Repository →
   Domain) **with DI container**. Boilerplate-heavy, premature for a
   solo-developer project of this size, and pulls focus from product work.

We want a **middle path**: introduce light module boundaries now, before
the codebase doubles, but stop short of formal layering ceremony.

## Decision

We adopt a **modular monolith** with the following structure and rules.

### Layout

```
Backend/src/
  modules/
    auth/
      routes.js       # Express router wiring (HTTP layer)
      service.js      # Business logic (the only place transactions are coordinated)
      queries.js      # All SQL for this module — the only file that touches `db` directly
      schemas.js      # zod request/response schemas
    users/
    problems/
    submissions/
    courses/          # added in Phase 1
    assessments/      # added in Phase 1
  shared/
    db.js             # database client export
    logger.js         # pino logger
    errors.js         # error classes + HTTP error helper
    middleware/       # auth, request-id, etc.
  index.js            # bootstrap (composes routers, applies middleware)
  migrations.js       # migration runner (called from index.js on boot)
```

### Allowed dependencies

- `module/routes.js` → `module/service.js` (own module) and shared
  middleware/utilities. **Never** to `queries.js` or `db` directly.
- `module/service.js` → `module/queries.js` (own module), shared utilities,
  and `OtherModule/service.js` (cross-module, via the public service API).
- `module/queries.js` → `shared/db.js` only.
- `module/schemas.js` → no internal dependencies.

### Forbidden dependencies

- Any file importing another module's `queries.js`.
- Any file outside a module's own folder reaching into its internals via
  relative paths (`../../other/queries.js`).
- `routes.js` performing more than one DB call inline; multi-step work
  must move into `service.js`.

### Enforcement

- ESLint rule `no-restricted-imports` configured with module-boundary
  patterns. Build fails on violation.
- Code review (self-review for now) explicitly checks the boundary.
- Tests focus on `service.js` for business logic and `routes.js` only for
  HTTP-shape concerns.

## Consequences

**Positive**
- Adding a new feature = adding (or extending) one module folder.
- Refactoring one module does not ripple through the codebase.
- The day we extract a module into a separate process (e.g., judge worker
  in Phase 1.5), the seam is already there.
- Onboarding any future hire takes one paragraph of architecture.

**Negative**
- Slightly more files than today (`routes.js` + `service.js` + `queries.js`
  vs a single `routes/X.js`).
- Discipline cost — must resist the temptation to add a quick `db.prepare`
  in a route during a hotfix.

## Explicit non-goals

- **No** repository interfaces with mock implementations. `queries.js`
  stays concrete; we test against a real Postgres in CI.
- **No** dependency-injection container. `service.js` files import
  `queries.js` and other services directly.
- **No** abstract "domain models" separate from DB rows. Service-level
  validation via zod is enough.

## Future re-evaluation

We will revisit if:
- A module's `service.js` exceeds ~600 lines (split into sub-services).
- Cross-module calls become so heavy that an in-process service registry
  helps (event bus or similar) — not expected before Phase 2.
