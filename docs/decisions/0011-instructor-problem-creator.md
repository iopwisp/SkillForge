# 0011 — Instructor problem creator

- **Status:** accepted (implementation shipped — uncommitted)
- **Date:** 2026-05-08

## Context

The Phase 1 university MVP already has:

1. courses
2. groups / enrolment
3. exams
4. gradebook

But the problem catalog is still effectively seed-only. That is not good
enough for a university pilot: an instructor must be able to author a new
backend / frontend / SQL / algorithm task without editing seed files or
restarting the installation.

This ADR settles the first authoring cut for problems.

## Decision

### Permissions

Problem authoring endpoints are gated by `requireRole(INSTRUCTOR, ADMIN)`.

Unlike courses, **problems do not have an owner column** in this phase.
That is an explicit product choice for now: the catalog is a shared
installation-level asset, and any instructor may improve, fix, or retire
any task. ADMIN remains universally allowed.

### Endpoints

```text
POST   /api/problems
GET    /api/problems/:slug/edit
PUT    /api/problems/:slug
DELETE /api/problems/:slug
```

`GET /api/problems/:slug` stays student-facing and continues to hide
authoring-only fields like `testCases`. The dedicated `/edit` endpoint is
the protected shape the future creator UI will load.

### Payload model

The creator API writes directly to the existing `problems` table. No new
authoring tables are introduced.

Create/update payloads expose the natural JSON shape already present in
seed files:

- `slug`, `title`, `description`, `difficulty`, `problemType`
- `categorySlug`
- `tags`, `examples`, `constraints`, `hints`, `starterCode`
- judge-specific fields:
  - `expectedOutput` for legacy heuristic algorithm tasks
  - `testCases` + `functionName` for JS-judged tasks
  - `sqlSetup` + `testCases` for SQL tasks
- `timeLimitMs`, `memoryLimitMb`, `isPremium`

The backend serializes `examples`, `hints`, `starterCode`, and
`testCases` into the existing `*_json` text columns.

### Validation rules

Base validation:

- stable slug format (same regex as courses/exams)
- closed enums for difficulty and problem type
- sane numeric limits for time / memory

Type-specific validation:

| Problem type | Required fields |
|---|---|
| `SQL` | `sqlSetup`, `starterCode.sql`, `testCases` |
| `BACKEND` / `FRONTEND` | `functionName`, `starterCode`, `testCases` |
| `ALGORITHM` | `expectedOutput` **or** (`testCases` + `functionName`) |

Update remains partial at the HTTP layer, but the service merges the
patch with the current row and then re-validates the full resulting
definition. That prevents invalid type switches like "turn BACKEND into
SQL without providing `sqlSetup`".

### Delete safety

Although the database would happily cascade problem deletion through
`course_problems`, `exam_problems`, and `submissions`, that is too risky
for the pilot. Silent cascades would mutate live syllabi, exam
definitions, and grade history.

So `DELETE /api/problems/:slug` is blocked with 409 when the problem is
referenced by any of:

- `course_problems`
- `exam_problems`
- `submissions`

Only truly unused problems may be deleted.

## Consequences

**Positive**

- Instructors can manage the live catalog without touching seed files.
- The future creator UI gets a dedicated edit payload that does not leak
  to students.
- Safe-delete behavior preserves course/exam integrity and historical
  submissions.

**Negative**

- No problem ownership means instructors can edit each other's tasks.
  That is acceptable for the pilot but may become too open later.
- The payload model is still judge-centric, not a polished authoring DSL.
  That is fine for an internal MVP.

## Explicit non-goals

- **No** per-problem owner / collaborator model.
- **No** draft/publish workflow.
- **No** version history or rollback for problem edits.
- **No** attachment upload pipeline (images/files inside problem statements).
- **No** frontend creator UI in this commit; this ADR covers backend only.

## Future re-evaluation

We revisit if:

- instructors need private drafts or ownership boundaries
- problem edits need audit/history
- the pilot demands richer authoring (statement attachments, hidden tests,
  reusable fixtures, plagiarism metadata)
