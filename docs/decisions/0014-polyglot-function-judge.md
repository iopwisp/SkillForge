# ADR 0014 — Polyglot function judge for Python, Java, and Go

Date: 2026-05-09

## Status

Accepted (initial implementation)

## Context

SkillForge originally had two real judges:

- SQL via per-submission in-memory SQLite.
- JavaScript/TypeScript via `isolated-vm`.

The UI already hinted at multiple languages for some algorithm problems, but
function-based backend/frontend tasks were effectively JavaScript-only. For a
university-facing product, students should be able to solve the same
function-style task in common teaching languages such as Python, Java, and Go.

## Decision

Add a polyglot function judge for `testCases`-backed problems:

- `python` / `python3` / `py`
- `java`
- `go` / `golang`

The public problem contract remains the same:

```json
{ "args": [...], "expected": ... }
```

Language-specific runners adapt that contract:

- Python imports `solution.py` and calls either a top-level function or a
  `Solution` instance method with the configured `function_name`.
- Java compiles `Solution.java` plus a generated `Runner.java`, then calls
  `new Solution().<function_name>(...)`.
- Go compiles `solution.go` plus a generated `runner.go`, then calls
  `<function_name>(...)`.

JavaScript/TypeScript still use `isolated-vm`. SQL still uses SQLite. Legacy
algorithm problems without `test_cases_json` still use the old heuristic judge
until they are converted to real test cases.

## Runtime mode

External languages use `JUDGE_RUNTIME_MODE`:

- `auto` — local runtime first, then already-pulled Docker image.
- `local` — local runtime only.
- `docker` — Docker sandbox containers.
- `off` — disabled.

Docker mode runs with:

- `--network none`
- memory / CPU / pids limits
- `--cap-drop ALL`
- `--security-opt no-new-privileges`
- read-only container filesystem plus tmpfs `/tmp`

The backend runtime image includes `docker-cli`; deployments that want Docker
mode must provide access to a Docker daemon and pre-pull or allow pulling the
runtime images.

## Consequences

- Students can now submit Python, Java, and Go for function-based problems.
- Go in local development requires either a local `go` binary or an already
  pulled `golang:1.23-alpine` image.
- The Java/Go runners are intentionally function-based, not stdin/stdout
  competitive-programming style.
- This is still not the final graded-exam sandbox story. Docker-per-submission
  isolation remains the preferred Phase 2 direction for high-stakes exams.
