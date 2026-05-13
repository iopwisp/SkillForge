# 0010 — Gradebook + CSV export

- **Status:** accepted (implementation shipped — uncommitted)
- **Date:** 2026-05-08

## Context

After groups and exams land, instructors still need the simplest
possible university artifact: "show me every enrolled student and their
score on each exam, and let me export the same table to CSV for Excel /
the dean's office".

Phase 1 does **not** need a full LMS grading engine yet. The minimum
usable workflow for the AITU pilot is:

1. Enrol students into groups.
2. Run course-wide and/or group-scoped exams.
3. Open a per-course gradebook.
4. Export that gradebook to CSV.

The existing schema already contains enough information to answer that
query:

- enrolment lives in `groups` + `group_members`
- exam metadata lives in `exams` + `exam_problems`
- student work lives in `exam_attempts` + `submissions`

So the gradebook should be a **read model over existing tables**, not a
new cache table in Phase 1.

## Decision

### Endpoints

```text
GET /api/courses/:slug/gradebook
GET /api/courses/:slug/gradebook.csv
```

Both endpoints are:

- behind `requireRole(INSTRUCTOR, ADMIN)` at the route layer
- additionally restricted to **course owner OR ADMIN** in
  `courses.service`

This mirrors the course mutation permission model from ADR 0007: another
instructor on the same installation must not see a colleague's roster by
default.

### Row model

The gradebook returns **one row per enrolled student** in the course.
Enrolment is defined exactly as in ADR 0008: a user appears in the
gradebook iff they are present in `group_members` for a group belonging
to that course.

Each row contains:

- student identity (`id`, `username`, `fullName`, `avatarUrl`)
- the student's groups within the course
- one score cell per exam in that course
- a total over the exams that actually apply to that student

### Exam applicability

There are two exam kinds already established by ADR 0009:

- **course-wide** exam — `group_id IS NULL`
- **group-scoped** exam — `group_id = some group`

Applicability in the gradebook is:

| Exam type | Student gets a cell? |
|---|---|
| course-wide | yes, if the student is enrolled anywhere in the course |
| group-scoped | yes, only if the student belongs to that specific group |

If an exam does **not** apply to a student, the JSON gradebook marks the
cell as `applicable: false` and the CSV export leaves the cell blank.
That exam is also excluded from the row total.

### Score semantics

Per exam cell:

- `attempted = true` iff an `exam_attempts` row exists for that
  `(exam_id, user_id)`
- score is computed on demand from `submissions`
- points are full-credit only, exactly as in ADR 0009

So for an applicable exam:

- no attempt yet => `0 / total_points`
- attempt with some solved problems => `earned / total_points`
- not applicable => blank in CSV, `score: null` in JSON

Totals are:

```text
total.earned = sum(earned points across applicable exams)
total.total  = sum(total points across applicable exams)
```

No extra weighting, curve, practice-score blending, or manual override
exists in this phase.

### CSV shape

The CSV is a direct flat rendering of the same read model:

```text
username,full_name,groups,<exam-slug-1>,<exam-slug-2>,...,total
```

Rules:

- `groups` is a semicolon-separated list of group slugs
- each exam column is `earned/total` for applicable exams
- non-applicable exams are empty cells
- `total` is `earned/total`

We use **exam slugs** as the column headers because they are stable and
already unique per course (ADR 0009).

## Consequences

**Positive**

- No new tables or background recompute job in Phase 1.
- JSON and CSV are generated from the same source of truth, so they
  cannot drift.
- Group-scoped exams naturally fit the roster without inventing fake
  zeros for students who were never meant to take them.

**Negative**

- Gradebook reads become a moderately heavy join as courses/exams grow.
  That is acceptable for the pilot; caching can come later if profiling
  shows a problem.
- The CSV is intentionally minimal. If a university wants richer exports
  (student IDs, percentages, per-attempt timestamps), we extend the
  read model later.

## Explicit non-goals

- **No** persisted gradebook cache table.
- **No** manual grade overrides or comments.
- **No** practice submission columns yet.
- **No** percentage grades, letter grades, GPA mapping, or rubric engine.
- **No** instructor-assistant visibility model beyond owner-or-ADMIN.

## Future re-evaluation

We revisit if:

- gradebook reads show up on a flame graph → add a cache table or
  materialized view
- the pilot wants practice-score columns → extend the row model with
  explicit non-exam aggregates
- universities demand SIS import/export conventions → add alternate CSV
  schemas rather than overloading the default one
