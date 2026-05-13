# 0006 — User roles for the university model

- **Status:** accepted (foundation only — middleware + bootstrap; the
  feature endpoints that consume the roles land later in Phase 1)
- **Date:** 2026-05-08

## Context

Phase 0 shipped with a single role `'USER'` (the default value of the
`role` column on `users`). That was fine for a public coding-practice
SPA but it does not survive contact with a university:

- A **student** must be able to read problems, submit code, see their
  rating and history.
- An **instructor** must additionally be able to create problems,
  assemble courses, run exams, and see their students' submissions.
- An **administrator** must additionally be able to enrol or remove
  students, promote instructors, and see installation-wide stats.

These three roles are baked into how every Kazakhstan university we
have looked at organises its IT department (студент / преподаватель /
админ платформы). Having more granular roles would just mean defining
permission sets that always coincide with one of these three, which is
not worth the extra complexity for a single-tenant on-prem product.

This ADR settles the role *primitives*. The endpoints that consume them
(course CRUD, group enrolment, exam creation, gradebook) ship in
subsequent Phase 1 commits.

## Decision

### The three roles

```
STUDENT      — default; can solve problems and view their own data
INSTRUCTOR   — STUDENT + can create problems, courses, exams, see
               their students' work
ADMIN        — INSTRUCTOR + can promote/demote users, manage the
               installation
```

Roles are **strictly ordered by capability**: every ADMIN can do what
an INSTRUCTOR can, every INSTRUCTOR can do what a STUDENT can. We
encode this in `requireRole(...)` rather than as a hierarchy on the DB
side; this keeps queries trivially "WHERE role = $1" when we genuinely
need a single role and lets the middleware fan out to multiple roles
when a route is shared (e.g. course read-only endpoints accept all
three).

### Storage

We keep `users.role` as `TEXT` plus a CHECK constraint, not a Postgres
ENUM type:

```sql
ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'STUDENT',
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('STUDENT', 'INSTRUCTOR', 'ADMIN'));
```

Reason: ENUM types in Postgres make schema migrations more painful
(the `ALTER TYPE … ADD VALUE` cannot run inside a transaction in older
versions; renaming or removing values is verboten). TEXT + CHECK keeps
forward-only migrations compatible with the migration runner in
`shared/migrations.js`, and the list of valid roles is small enough
that the runtime check is irrelevant.

The `'USER'` rows that exist today are migrated to `'STUDENT'` in
`db/migrations/0002_user_roles.sql` before the CHECK constraint is
added.

### Bootstrap on a fresh installation

A fresh on-prem deployment has zero users. The very first registration
through `POST /api/auth/register` (or via the local provider during
SSO account creation) becomes `ADMIN`. Every subsequent self-service
registration is `STUDENT`. The check is `SELECT 1 FROM users LIMIT 1`
inside the same SQL transaction as the insert.

Why this is safe in single-tenant on-prem (per ADR 0001):
- There is at most one installation per customer.
- The customer's IT person is the one bootstrapping the system.
- A race between two people hitting `/register` on a brand-new install
  in the same millisecond is essentially impossible in practice; we
  accept the tiny risk in exchange for not having to ship a separate
  CLI bootstrap step.

### Middleware

Two helpers in `src/modules/auth/middleware.js`:

```js
requireAuth(req, res, next)            // 401 unless a valid Bearer
optionalAuth(req, res, next)           // populates req.user when present

requireRole(...allowed)(req, res, next)
  // 401 unless valid Bearer
  // 403 if req.user.role not in `allowed`
  // otherwise → req.user populated, next()
```

Usage:

```js
// only admins can promote
router.put('/users/:id/role', requireRole('ADMIN'), handler);

// instructors and admins can both create courses
router.post('/courses', requireRole('INSTRUCTOR', 'ADMIN'), handler);

// any authenticated user can read their own gradebook
router.get('/gradebook/me', requireAuth, handler);
```

`requireRole(...)` re-implements the auth check inline rather than
chaining `requireAuth` first; this keeps the route definition a single
middleware to reason about and prevents a bug where someone forgets
the `requireAuth` and the role check runs on `req.user === undefined`.

### Promotion / demotion

Out of scope of this ADR — comes with the admin UI. The minimum
machinery to make it implementable is:

- `users.service.setRole(adminId, targetUserId, newRole)` will live
  in the users module.
- An ADMIN cannot demote themselves to a non-ADMIN role if they are
  the *only* ADMIN on the installation. This safeguard prevents the
  installation from having no admin.

## Consequences

**Positive**
- All future authorisation (courses, groups, exams, gradebook) is one
  middleware call away.
- The default role for self-service signups is `STUDENT`, which is the
  correct safe default for a multi-thousand-student deployment.
- `'USER'` is gone from the codebase, so we never accidentally invent
  a fourth role by typo.

**Negative**
- The first-registration-becomes-ADMIN trick means a new install must
  be configured by *its* admin first and then handed off to students;
  the operations docs need to mention this.
- TEXT + CHECK means a typo in route code (e.g. `requireRole('admin')`
  lowercase) will silently 403 everyone. Mitigated by exporting role
  constants from `auth/middleware.js`.

## Explicit non-goals

- **No** RBAC engine, no permission strings, no per-row ACLs.
- **No** group-level roles ("instructor of group X"). Group
  membership is its own table; a user is either an instructor (period)
  or not.
- **No** TA / grader tier inside INSTRUCTOR. If a customer asks for it
  later we revisit.
- **No** multi-tenant wiring of any kind. Per ADR 0001 each university
  has its own installation; the role values are NOT scoped per tenant.

## Future re-evaluation

We revisit if:
- A customer asks for a TA role distinct from INSTRUCTOR. Likely
  outcome: add a `'TA'` value, rebuild the CHECK constraint in a new
  migration.
- We need group-scoped instructor permissions ("Alice is an instructor
  for group A but not group B"). This implies a `group_members(role)`
  column rather than touching `users.role`.
