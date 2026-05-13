# ADR 0015 — STDIO judge for stdin/stdout problems

Date: 2026-05-09

## Status

Accepted (implementation in progress)

## Context

SkillForge currently judges two problem shapes:

- **Function-style** — JS/TS via `isolated-vm`, Python/Java/Go via the
  polyglot runner (ADR 0014). The student provides a function body; the
  judge invokes it with JSON arguments per test case.
- **SQL** — SQLite in-memory. The student writes a query; the judge
  compares result sets.

Classic university courses like *Intro to Programming* and *Advanced
Programming* at AITU are built almost entirely around stdin/stdout
problems ("read N, then N integers, print the sum"; FizzBuzz; read a
list and sort it). This is also the canonical shape used on Codeforces,
Kattis, and ACM-ICPC.

The existing function-call shape does not fit these problems. Students
expect to write a full program that reads from standard input and writes
to standard output, and instructors expect per-test verdicts with
resource limits matching contest conventions.

Full specification:
- [requirements.md](../../.kiro/specs/stdio-judge/requirements.md)
- [design.md](../../.kiro/specs/stdio-judge/design.md)

## Decision

Add a first-class **STDIO** problem type to SkillForge with the following
characteristics:

### Problem type discriminator

A new `problems.problem_type = 'STDIO'` value with dedicated columns:

- `output_size_cap_kb INTEGER` — max bytes captured from stdout (1–1024 KB)
- `comparator_mode TEXT` — one of `EXACT`, `TRIMMED`, `WHITESPACE_NORMALIZED`
- `language_allowlist TEXT[]` — non-empty subset of supported languages

Existing columns `time_limit_ms` and `memory_limit_mb` are reused. The
migration (`0008_stdio_problems.sql`) adds CHECK constraints gated on
`problem_type = 'STDIO'` so non-STDIO rows are unaffected.

### Test case shape

STDIO test cases live in the existing `test_cases_json` column with a
new element shape:

```ts
type StdioTestCase = {
  stdin: string;
  expected_stdout: string;
  visibility: 'SAMPLE' | 'HIDDEN';
  name?: string;
};
```

- **SAMPLE** cases are visible to students in the problem description
  and in per-test failure output.
- **HIDDEN** cases are used for grading only; students see only the
  verdict and resource metrics, never the stdin, expected output, or
  actual output.

### Comparator modes

Three modes cover ~100% of Intro/Advanced Programming problems without
introducing custom-checker complexity:

| Mode | Behaviour |
|------|-----------|
| `EXACT` | Byte-for-byte comparison |
| `TRIMMED` | Strip one optional trailing `\n` or `\r\n` from each side |
| `WHITESPACE_NORMALIZED` | Collapse whitespace runs to single space, trim ends |

Floating-point tolerance (`FLOAT`) is a documented non-goal for v1.

### Per-problem language allowlist

Each STDIO problem declares which languages students may submit in. The
allowlist is a non-empty subset of `{ JAVASCRIPT, PYTHON, JAVA, GO, CPP }`.
Submissions in a language not on the allowlist are rejected with HTTP 400
`LANGUAGE_NOT_ALLOWED` before any row is inserted.

### Per-test visibility

Test cases are marked `SAMPLE` or `HIDDEN`. The public problem endpoint
(`GET /api/problems/:slug`) returns only SAMPLE cases. The editor endpoint
(`GET /api/problems/:slug/edit`) returns all cases unredacted. Per-test
results for HIDDEN cases never include stdin, expected output, or actual
output — only the verdict and resource metrics.

### Contest semantics for overall verdict

The submission-level verdict is the per-test verdict of the **first
failing test case** in declared order; `ACCEPTED` only if every test
passes. This matches Codeforces / Kattis / ACM-ICPC conventions.

### Resource limits

Per-test enforcement:

- **Time limit** — wall-clock ceiling; SIGKILL at `1.5 × time_limit_ms`
- **Memory limit** — peak RSS ceiling; SIGKILL at `1.5 × memory_limit_mb`
- **Output limit** — stop capturing + SIGKILL when stdout exceeds cap

Defaults: `time_limit_ms = 2000`, `memory_limit_mb = 256`,
`output_size_cap_kb = 64`, `comparator_mode = 'TRIMMED'`.

### Runtime mode

STDIO honours the existing `JUDGE_RUNTIME_MODE` env from ADR 0014:

| Mode | Behaviour |
|------|-----------|
| `local` | Non-privileged subprocess against locally-installed runtimes |
| `docker` | Ephemeral container with `--network=none`, `--read-only`, `--tmpfs=/tmp` |
| `auto` | Prefer Docker when daemon is reachable, fall back to local |
| `off` | Return `JUDGE_ERROR` with reason "STDIO judging is disabled" |

### C++ as a new runtime addition

C++ (`g++ -O2 -std=c++17 -pipe`) is added as a new language in the
polyglot runtime layer. This is the Codeforces default and what AITU's
Intro course expects.

**Escape hatch (R13.4):** If integrating C++ blocks the MVP, ship
JavaScript/Python/Java/Go as v1 and file a follow-up spec for C++.
The follow-up is tracked explicitly in the tasks document rather than
left implicit.

### Integration with existing systems

| System | Integration |
|--------|-------------|
| Async judge pipeline (ADR 0013) | STDIO uses the same `submit → enqueue → finalize` two-phase flow |
| Idempotency | `Idempotency-Key` header works identically |
| Exam filtering (ADR 0009) | `exam_attempt_id IS NULL` filter excludes STDIO exam rows from public feed |
| Module boundaries (ADR 0003) | New code lives in `modules/judge/` and `modules/problems/`; no cross-module query imports |
| Single-tenant (ADR 0001) | No `tenant_id` on the new migration or code paths |

### Run flow

The non-persisted Run flow (`POST /api/submissions/:slug/run`) accepts an
optional `stdin` field for STDIO problems. The student enters custom input,
the server executes once under per-problem limits, and returns stdout/stderr
without writing a submission row.

## Consequences

### Positive

- AITU instructors can author Intro/Advanced Programming problems in the
  same platform as function-style and SQL problems.
- Students get the familiar stdin/stdout workflow with per-test verdicts
  and resource metrics.
- Contest semantics (first-failure, ordered test cases) match student
  expectations from Codeforces/Kattis.
- C++ support covers the canonical Intro-to-Programming language.

### Negative / costs

- One more problem type to maintain in the editor, judge, and serialisers.
- Memory limit enforcement in `local` mode is best-effort (RSS polling);
  hard limits require `docker` mode.
- C++ adds a new runtime dependency (`g++` locally or the `gcc:13-bookworm`
  Docker image).

### Out of scope

- Custom checker (SPJ) for problems requiring semantic comparison.
- Floating-point tolerance comparator mode.
- Interactive problems (two-way communication with the judge).
- Partial scoring (all-or-nothing per test case).

## Implementation outline

1. Migration `0008_stdio_problems.sql` widens `problems.type` CHECK and
   adds STDIO-specific columns.
2. Pure comparator in `modules/judge/stdio-comparator.js` with property
   tests.
3. Per-language prepare layer in `modules/judge/stdio-prepare.js`
   (Node, Python, Java, Go, C++).
4. Execution layer in `modules/judge/stdio-exec.js` with limit
   enforcement and verdict classification.
5. Judge dispatcher branch in `modules/judge/service.js` routes STDIO
   to the new judge.
6. Problems module extended with STDIO schema, defaults, and
   public/editor serialisers.
7. Submissions module extended with language-allowlist gate and Run-flow
   stdin handling.
8. Seed catalog with three STDIO problems (`stdio-sum-of-n`,
   `stdio-fizzbuzz`, `stdio-stable-sort-by-key`).
9. Frontend ProblemForm STDIO branch and student problem-detail view
   with stdin/stdout panels and per-test results.
10. Integration tests covering authoring, runtime, and exam paths.

