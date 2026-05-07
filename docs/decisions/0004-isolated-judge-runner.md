# 0004 — Replace Node `vm` with an isolated runner for the JS judge

- **Status:** accepted (implementation pending)
- **Date:** 2026-05-07

## Context

`Backend/src/judge.js` executes student-submitted JavaScript inside Node's
built-in `vm` module with a script timeout. **The Node `vm` module is not a
security boundary.** It shares the V8 isolate and the host process with the
running server. A motivated student can break out of `vm` with a few lines
of code and read process environment variables, the JWT signing secret,
the database file, or files on disk.

Examples that break the current sandbox:

- `this.constructor.constructor('return process')()` — recovers `process`.
- Accessing `Reflect`, `Function`, or asynchronous APIs that survive the
  `vm.runInContext` call.
- Long synchronous tight loops can be killed by V8 interrupts but only on
  the call boundary; async operations leak.

For a free demo this is acceptable. For a product sold to universities
where students will deliberately try to game graded exams, this is a
**deal-blocker**. Any competent security review will surface it and the
contract will not be signed.

## Decision

Replace `vm` with a real isolation boundary. Two viable options:

### Option A — `isolated-vm` (in-process V8 isolate)

- Real V8 isolate per submission, with no access to host objects unless
  we explicitly expose them.
- Fast (millisecond-level startup).
- Pure JavaScript/TypeScript only.
- Limits: memory and time enforced by `isolated-vm` API.
- Library is well-maintained but native; requires build toolchain on
  installs.

### Option B — Docker-per-submission

- Each submission runs in a short-lived container (`node:20-alpine` or
  similar) with `--network none`, restricted seccomp profile, read-only
  filesystem, memory and CPU limits.
- Higher startup cost (~100ms+) but rock-solid isolation.
- Naturally extends to other languages (Python, Java, C++) by swapping
  the image.
- Requires Docker on the host; reasonable for an on-prem deployment but
  adds an operational dependency.

### Plan

1. **Phase 0 (immediate):** Replace `vm` with `isolated-vm`. This kills
   the easy escapes and is sufficient for non-graded "Run" actions and
   for the AITU pilot's first courses. Memory and time limits are
   enforced by the library.
2. **Phase 2 (before first graded exam):** Add a `Docker` runner mode for
   graded submissions. Configurable per deployment (`JUDGE_RUNTIME=isolated-vm`
   or `JUDGE_RUNTIME=docker`). Default to `docker` once available.
3. **Future:** Either runner may be replaced with a queue-fed worker pool
   in Phase 1.5 without changing the judge interface.

## Consequences

**Positive**
- Closes the largest single security hole in the product.
- Establishes a clean interface (`runJsJudge(problem, code) → result`) that
  the queue worker in Phase 1.5 can adopt unchanged.
- Per-language extension becomes feasible (Docker-based).

**Negative**
- `isolated-vm` is a native module — adds a build step on `npm install`.
  Addressed by shipping prebuilt binaries via `prebuild-install` or by
  documenting the build dependencies for on-prem.
- Docker-based runner adds an operational dependency at customer sites.
  Acceptable since `docker compose` is already the install mechanism.

## Explicit non-goals

- **Not** building our own ptrace/seccomp sandbox from scratch. We are
  not in the sandbox business; we use libraries that are.
- **Not** supporting arbitrary language runners on day one. JavaScript
  and SQL are enough for the niche we are targeting (web/backend/SQL).
  Python is the next likely addition, not C++/Java.

## Future re-evaluation

We will reconsider if:
- A pilot customer requires a language we cannot run in the chosen
  isolation (e.g., needing native modules in student code).
- A sandbox-escape is reported in the chosen library and not patched
  promptly upstream — at which point we may move sooner to Docker-only.
