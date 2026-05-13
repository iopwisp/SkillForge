# Requirements Document

## Introduction

SkillForge's STDIO judge (ADR 0015) and polyglot function judge (ADR 0014)
already support a `JUDGE_RUNTIME_MODE=docker` path that spawns ephemeral
containers per test case. The current implementation provides basic isolation
(`--network=none`, `--read-only`, `--memory`) but lacks production-grade
hardening needed for graded exams, contests, and untrusted code execution.

This feature upgrades Docker-mode judging to **production-grade per-submission
isolation** by consolidating the container lifecycle to one container per
submission (compile + run all test cases inside a single container), adding
hardened security flags (PID limits, file-descriptor limits,
`no-new-privileges`, CPU caps), enforcing a per-submission timeout at the
container level, pre-pulling images on worker startup, and providing graceful
degradation when Docker is unavailable.

The upgrade targets three deployment scenarios:
1. **Graded exams** — students cannot escape the sandbox or affect each other.
2. **Contests** — fair resource enforcement (CPU, memory, PID, network).
3. **Untrusted code** — C++ submissions cannot fork-bomb, read host files, or
   make outbound connections.

Hard constraints from the existing architecture:
- ADR 0001: single-tenant on-prem; Docker daemon is on the same host.
- ADR 0003: modular monolith boundaries; Docker execution logic lives in
  `modules/judge/`.
- ADR 0013: async judge pipeline; containers are spawned by the worker process
  during `finalize()`.
- ADR 0014: polyglot function judge already has `JUDGE_RUNTIME_MODE=docker`.
- ADR 0015: STDIO judge already has `buildDockerRunStep()` with
  `--network=none --read-only --tmpfs=/tmp`.
- Existing `runtimes.js` has `DOCKER_IMAGES` map and `resolveRuntime()`.
- Existing `stdio-prepare.js` has `STDIO_DOCKER_FLAGS` and
  `buildDockerRunStep()`.

## Glossary

- **Submission_Container**: A single Docker container that executes the entire
  lifecycle of one submission — compilation (if applicable) followed by all
  test-case executions. Replaces the current per-test-case container pattern.
- **Container_Lifecycle_Manager**: The new module-internal component in
  `modules/judge/` responsible for creating, starting, executing commands in,
  and destroying Submission_Containers.
- **Hardened_Flags**: The complete set of Docker security and resource flags
  applied to every Submission_Container: `--network=none`, `--read-only`,
  `--tmpfs=/tmp:rw,noexec,nosuid,size=128m`, `--pids-limit=64`, `--cpus=1`,
  `--memory=<limit>m`, `--ulimit nofile=64:64`,
  `--security-opt=no-new-privileges`.
- **Per_Submission_Timeout**: A wall-clock ceiling on the entire container
  lifetime, computed as `time_limit_ms * test_count * 1.5 + compile_overhead`.
  If exceeded, the container is forcibly killed.
- **Image_Pre_Pull**: The process of pulling all configured Docker images to
  the local daemon cache on worker startup, so the first submission does not
  pay a multi-second pull penalty.
- **Graceful_Degradation**: The behaviour when Docker is unavailable: if
  `JUDGE_RUNTIME_MODE=auto`, fall back to local mode; if
  `JUDGE_RUNTIME_MODE=docker`, return `JUDGE_ERROR`.
- **STDIO_Judge**: The judge branch handling `problem.type = 'STDIO'` via
  stdin/stdout execution (ADR 0015).
- **Polyglot_Function_Judge**: The judge branch handling function-style
  problems in Python/Java/Go via generated runners (ADR 0014).
- **Worker_Process**: The BullMQ worker (`src/worker.js`) that dequeues judge
  jobs and calls `finalize()` (ADR 0013).
- **Seccomp_Profile**: An optional JSON file restricting system calls available
  inside the container. Documented as a stretch goal; authoring is out of scope.
- **Run_Flow**: The non-persisted `POST /api/submissions/:slug/run` endpoint
  that executes code without writing a submission row.

## Requirements

### Requirement 1: Per-submission container lifecycle

**User Story:** As a platform operator, I want one Docker container per
submission (not per test case), so that container startup overhead is paid
once and the attack surface is a single container boundary per submission.

#### Acceptance Criteria

1. WHERE `JUDGE_RUNTIME_MODE` is `docker`, WHEN the STDIO_Judge processes a
   submission, THE Container_Lifecycle_Manager SHALL create exactly one
   Submission_Container for the entire submission lifecycle (compilation plus
   all test-case executions).
2. WHERE `JUDGE_RUNTIME_MODE` is `docker`, WHEN the Polyglot_Function_Judge
   processes a submission, THE Container_Lifecycle_Manager SHALL create exactly
   one Submission_Container for the entire submission lifecycle (compilation
   plus all test-case executions).
3. WHEN all test cases have been executed or the submission is terminated
   early (timeout, compile error, or judge error), THE
   Container_Lifecycle_Manager SHALL destroy the Submission_Container within
   5 seconds of the last test-case completion or termination event.
4. THE Container_Lifecycle_Manager SHALL mount the student source code into
   the container as a read-only volume and SHALL capture stdout and stderr
   via pipes, matching the existing volume-mount pattern in
   `buildDockerRunStep()`.
5. IF the Submission_Container fails to start (image not found, daemon error,
   or resource exhaustion), THEN THE Container_Lifecycle_Manager SHALL return
   a `JUDGE_ERROR` verdict with a human-readable diagnostic and SHALL NOT
   attempt to run any test case.

### Requirement 2: Hardened container security flags

**User Story:** As a platform operator running graded exams, I want every
submission container to enforce PID limits, CPU caps, file-descriptor limits,
and privilege restrictions, so that a malicious submission cannot fork-bomb,
starve the host CPU, exhaust file descriptors, or escalate privileges.

#### Acceptance Criteria

1. THE Container_Lifecycle_Manager SHALL apply `--pids-limit=64` to every
   Submission_Container, preventing the student process from spawning more
   than 64 processes or threads.
2. THE Container_Lifecycle_Manager SHALL apply `--cpus=1` to every
   Submission_Container, limiting the container to one logical CPU core.
3. THE Container_Lifecycle_Manager SHALL apply `--ulimit nofile=64:64` to
   every Submission_Container, limiting the number of open file descriptors
   to 64.
4. THE Container_Lifecycle_Manager SHALL apply
   `--security-opt=no-new-privileges` to every Submission_Container,
   preventing the student process from gaining additional privileges via
   setuid binaries or capability inheritance.
5. THE Container_Lifecycle_Manager SHALL apply `--network=none` to every
   Submission_Container, preventing the student process from opening TCP or
   UDP connections to any destination.
6. THE Container_Lifecycle_Manager SHALL apply `--read-only` to every
   Submission_Container, making the root filesystem read-only.
7. THE Container_Lifecycle_Manager SHALL apply
   `--tmpfs=/tmp:rw,noexec,nosuid,size=128m` to every Submission_Container,
   providing a writable tmpfs for compilation artifacts and temporary files.
8. THE Container_Lifecycle_Manager SHALL apply `--memory=<limit>m` to every
   Submission_Container, where `<limit>` is the problem's `memory_limit_mb`
   value.
9. IF a future `seccomp_profile_path` configuration is provided via the
   `JUDGE_SECCOMP_PROFILE` environment variable, THEN THE
   Container_Lifecycle_Manager SHALL additionally apply
   `--security-opt seccomp=<path>` to every Submission_Container.
10. WHEN `JUDGE_SECCOMP_PROFILE` is not set or is empty, THE
    Container_Lifecycle_Manager SHALL use Docker's default seccomp profile
    and SHALL NOT pass any `seccomp=` flag.

### Requirement 3: Per-submission timeout enforcement

**User Story:** As a platform operator, I want the entire container to be
killed after a computed per-submission timeout, so that a stuck or malicious
submission cannot block the worker indefinitely.

#### Acceptance Criteria

1. THE Container_Lifecycle_Manager SHALL compute the per-submission timeout
   as `time_limit_ms * test_count * 1.5 + compile_overhead_ms`, where
   `compile_overhead_ms` defaults to 30000 for compiled languages (JAVA, GO,
   CPP) and 0 for interpreted languages (JAVASCRIPT, PYTHON).
2. IF the Submission_Container has not exited within the computed
   per-submission timeout, THEN THE Container_Lifecycle_Manager SHALL
   forcibly kill the container (equivalent to `docker kill`) and SHALL record
   the overall verdict as `TIME_LIMIT_EXCEEDED`.
3. THE per-submission timeout SHALL be independent of and in addition to the
   per-test-case wall-clock timeout already enforced by the STDIO_Judge and
   Polyglot_Function_Judge.
4. WHEN the container is killed due to per-submission timeout, THE
   Container_Lifecycle_Manager SHALL include a diagnostic message indicating
   the submission exceeded the aggregate time budget, distinguishing it from
   a single-test TLE.
5. THE per-submission timeout SHALL have a configurable minimum floor of
   10000 ms and a maximum ceiling of 300000 ms, clamped silently if the
   computed value falls outside this range.

### Requirement 4: Image pre-pull on worker startup

**User Story:** As a platform operator, I want the worker process to pre-pull
all configured Docker images on boot, so that the first submission after
deployment does not pay a 30+ second image-pull penalty.

#### Acceptance Criteria

1. WHERE `JUDGE_RUNTIME_MODE` is `docker` or `auto`, WHEN the Worker_Process
   starts, THE Worker_Process SHALL attempt to pull every image in the
   configured image set (node, python, java, go, cpp) before accepting judge
   jobs from the queue.
2. IF an image pull fails (network error, authentication failure, or image
   not found), THEN THE Worker_Process SHALL log a warning with the image
   name and error reason and SHALL continue startup with the remaining
   images.
3. THE Worker_Process SHALL NOT block startup for more than 120 seconds
   total across all image pulls; if the cumulative pull time exceeds 120
   seconds, THE Worker_Process SHALL log a warning and proceed with whatever
   images are already cached.
4. WHERE `JUDGE_RUNTIME_MODE` is `local` or `off`, THE Worker_Process SHALL
   skip image pre-pull entirely and SHALL NOT invoke any Docker commands
   during startup.
5. WHEN an image is already present in the local Docker cache, THE
   Worker_Process SHALL detect this (via `docker image inspect`) and SHALL
   skip the pull for that image, completing in under 1 second per cached
   image.

### Requirement 5: Graceful degradation when Docker is unavailable

**User Story:** As a platform operator, I want clear and predictable
behaviour when Docker is unavailable, so that development environments
without Docker still work and production environments with Docker fail
loudly rather than silently.

#### Acceptance Criteria

1. WHERE `JUDGE_RUNTIME_MODE` is `auto` AND the Docker daemon is not
   reachable (probe fails within 2 seconds), THE Container_Lifecycle_Manager
   SHALL fall back to local subprocess execution, matching the existing
   auto-selection behaviour in `resolveRuntime()`.
2. WHERE `JUDGE_RUNTIME_MODE` is `docker` AND the Docker daemon is not
   reachable, THE Container_Lifecycle_Manager SHALL return a `JUDGE_ERROR`
   verdict with a diagnostic message indicating Docker is required but
   unavailable.
3. WHERE `JUDGE_RUNTIME_MODE` is `docker` AND the Docker daemon is not
   reachable, THE Container_Lifecycle_Manager SHALL NOT attempt local
   subprocess execution as a fallback.
4. WHERE `JUDGE_RUNTIME_MODE` is `local`, THE Container_Lifecycle_Manager
   SHALL execute submissions as local subprocesses and SHALL NOT invoke any
   Docker commands.
5. IF the Docker daemon becomes unreachable after the worker has started
   (mid-flight failure), THEN THE Container_Lifecycle_Manager SHALL return
   `JUDGE_ERROR` for the affected submission and SHALL NOT crash the worker
   process.

### Requirement 6: Integration with both judge types

**User Story:** As a platform developer, I want the per-submission container
lifecycle to work identically for STDIO and polyglot function judges, so that
both judge types benefit from the same hardened isolation without duplicating
container management logic.

#### Acceptance Criteria

1. THE Container_Lifecycle_Manager SHALL expose a unified interface that both
   `runStdioJudge` and the polyglot function judge (`runPythonJudge`,
   `runJavaJudge`, `runGoJudge`) call to obtain a Submission_Container.
2. WHEN `runStdioJudge` executes in Docker mode, THE STDIO_Judge SHALL
   delegate container creation and destruction to the
   Container_Lifecycle_Manager and SHALL NOT invoke `docker run` directly.
3. WHEN the Polyglot_Function_Judge executes in Docker mode, THE
   Polyglot_Function_Judge SHALL delegate container creation and destruction
   to the Container_Lifecycle_Manager and SHALL NOT invoke `docker run`
   directly.
4. THE Container_Lifecycle_Manager SHALL support both the STDIO execution
   pattern (pipe stdin per test case, capture stdout/stderr) and the
   function-judge execution pattern (run a generated runner script that
   outputs JSON lines).
5. THE Run_Flow (`POST /api/submissions/:slug/run`) SHALL use the same
   Container_Lifecycle_Manager when in Docker mode, creating a
   Submission_Container for the single Run execution and destroying it
   immediately after.

### Requirement 7: Existing local-mode behaviour stays unchanged

**User Story:** As a platform maintainer, I want all existing tests to pass
unchanged when `JUDGE_RUNTIME_MODE=local`, so that the Docker isolation
upgrade is strictly additive and does not regress development workflows.

#### Acceptance Criteria

1. WHERE `JUDGE_RUNTIME_MODE` is `local`, THE STDIO_Judge SHALL continue to
   execute submissions as local subprocesses using the existing
   `stdio-exec.js` logic, with no change in behaviour or verdict.
2. WHERE `JUDGE_RUNTIME_MODE` is `local`, THE Polyglot_Function_Judge SHALL
   continue to execute submissions as local subprocesses using the existing
   `runtimes.js` logic, with no change in behaviour or verdict.
3. WHEN the full `npm test` suite is run with `JUDGE_RUNTIME_MODE=local`,
   THE Test_Suite SHALL keep every pre-existing assertion green (judge,
   isolation, polyglot, stdio-comparator, judge-stdio-properties,
   judge-stdio-runtime, auth, submissions, exams, gradebook,
   problem-creator, audit-log, async-judge, seed suites).
4. THE Container_Lifecycle_Manager SHALL NOT be invoked or imported in any
   code path when `JUDGE_RUNTIME_MODE` is `local` or `off`.

### Requirement 8: Per-submission isolation between concurrent submissions

**User Story:** As an instructor running a graded exam, I want two concurrent
submissions to be completely isolated from each other, so that one student's
code cannot read another student's files, affect their output, or observe
their execution.

#### Acceptance Criteria

1. THE Container_Lifecycle_Manager SHALL assign each Submission_Container a
   unique, non-predictable container name derived from the submission ID or a
   random suffix.
2. THE Container_Lifecycle_Manager SHALL mount each submission's source code
   in a unique host-side temporary directory that is not accessible from any
   other Submission_Container.
3. WHEN two submissions execute concurrently in Docker mode, THE
   Container_Lifecycle_Manager SHALL ensure that neither container can observe
   the other's filesystem, process list, network activity, or stdout/stderr.
4. IF a student program attempts to list processes outside its own PID
   namespace, THEN THE Submission_Container SHALL return an empty or
   container-scoped process list (Docker's default PID namespace isolation).
5. WHEN a submission completes, THE Container_Lifecycle_Manager SHALL remove
   the host-side temporary directory and all its contents within 5 seconds.

### Requirement 9: Resource enforcement against adversarial submissions

**User Story:** As a platform operator, I want fork-bomb submissions to be
killed by the PID limit, memory-bomb submissions to be killed by the memory
limit, and CPU-hog submissions to be fairly scheduled, so that no single
submission can degrade the host or other submissions.

#### Acceptance Criteria

1. WHEN a student program inside a Submission_Container attempts to spawn
   more than 64 processes (fork bomb), THE Submission_Container SHALL deny
   the fork with EAGAIN and THE STDIO_Judge SHALL record a per-test verdict
   of `RUNTIME_ERROR`.
2. WHEN a student program inside a Submission_Container exceeds the
   configured `memory_limit_mb`, THE Submission_Container SHALL OOM-kill the
   process and THE STDIO_Judge SHALL record a per-test verdict of
   `MEMORY_LIMIT_EXCEEDED`.
3. WHEN a student program inside a Submission_Container attempts to open
   more than 64 file descriptors, THE Submission_Container SHALL deny the
   open with EMFILE and THE STDIO_Judge SHALL record a per-test verdict of
   `RUNTIME_ERROR`.
4. WHEN a student program inside a Submission_Container attempts to make an
   outbound network connection, THE Submission_Container SHALL deny the
   connection (no network namespace) and THE STDIO_Judge SHALL record a
   per-test verdict of `RUNTIME_ERROR`.
5. THE `--cpus=1` flag SHALL ensure that a CPU-intensive submission cannot
   consume more than one logical core, preventing starvation of other
   concurrent submissions on the same host.

### Requirement 10: Configuration via environment variables

**User Story:** As a platform operator, I want all Docker isolation parameters
to be configurable via environment variables with sensible defaults, so that
I can tune the sandbox without code changes.

#### Acceptance Criteria

1. THE Container_Lifecycle_Manager SHALL read `JUDGE_DOCKER_PIDS_LIMIT` to
   override the default PID limit of 64.
2. THE Container_Lifecycle_Manager SHALL read `JUDGE_DOCKER_CPU_LIMIT` to
   override the default CPU limit of 1.
3. THE Container_Lifecycle_Manager SHALL read `JUDGE_DOCKER_NOFILE_LIMIT` to
   override the default file-descriptor limit of 64.
4. THE Container_Lifecycle_Manager SHALL read `JUDGE_DOCKER_TMPFS_SIZE_MB` to
   override the default tmpfs size of 128 MB.
5. THE Container_Lifecycle_Manager SHALL read `JUDGE_DOCKER_COMPILE_OVERHEAD_MS`
   to override the default compile overhead of 30000 ms used in per-submission
   timeout computation.
6. THE Container_Lifecycle_Manager SHALL read `JUDGE_SECCOMP_PROFILE` to
   optionally apply a custom seccomp profile path.
7. WHEN any of the above environment variables is not set, THE
   Container_Lifecycle_Manager SHALL use the documented default value without
   logging a warning.

### Requirement 11: Deterministic verdicts across Docker and local modes

**User Story:** As a platform developer, I want the same code and input to
produce the same verdict regardless of whether it runs in Docker or local
mode, so that instructors can author problems locally and trust they will
grade identically in production Docker mode.

#### Acceptance Criteria

1. FOR ALL STDIO problems `p`, programs `c`, and languages
   `l ∈ p.language_allowlist`, WHEN `(p, c, l)` produces verdict `V` in
   local mode, THE STDIO_Judge SHALL produce the same verdict `V` in Docker
   mode, excluding `TIME_LIMIT_EXCEEDED` which may vary due to container
   startup overhead.
2. FOR ALL polyglot function problems `p`, programs `c`, and languages `l`,
   WHEN `(p, c, l)` produces verdict `V` in local mode, THE
   Polyglot_Function_Judge SHALL produce the same verdict `V` in Docker mode,
   excluding `TIME_LIMIT_EXCEEDED`.
3. THE Container_Lifecycle_Manager SHALL NOT add or modify environment
   variables visible to the student program beyond `PATH` and
   language-specific variables required for compilation (e.g. `GOCACHE`).
4. THE Container_Lifecycle_Manager SHALL set the working directory inside the
   container to `/workspace`, matching the existing `buildDockerRunStep()`
   convention.

### Requirement 12: Audit and observability

**User Story:** As a platform operator, I want container lifecycle events to
be logged, so that I can diagnose slow submissions, OOM kills, and timeout
events in production.

#### Acceptance Criteria

1. WHEN a Submission_Container is created, THE Container_Lifecycle_Manager
   SHALL log at `debug` level the container name, image, submission ID, and
   applied resource limits.
2. WHEN a Submission_Container is destroyed (normal completion, timeout kill,
   or error), THE Container_Lifecycle_Manager SHALL log at `debug` level the
   container name, exit reason, and wall-clock duration.
3. IF a Submission_Container is killed due to per-submission timeout, THEN
   THE Container_Lifecycle_Manager SHALL log at `warn` level the container
   name, submission ID, computed timeout value, and elapsed time.
4. IF a Submission_Container is OOM-killed, THEN THE
   Container_Lifecycle_Manager SHALL log at `warn` level the container name,
   submission ID, and configured memory limit.
5. THE Container_Lifecycle_Manager SHALL NOT log student source code, stdin
   content, or stdout content at any log level, to prevent accidental
   exposure of student work in log aggregators.

## Correctness Properties (Executable PBT Candidates)

The following properties are intended to be encoded as property-based tests
and integration tests to verify the isolation guarantees.

1. **Isolation between concurrent submissions.** For all pairs of submissions
   `(S1, S2)` executing concurrently in Docker mode, S1's stdout SHALL be
   identical to S1 executed alone, and S2's stdout SHALL be identical to S2
   executed alone. Neither submission can observe the other's files, processes,
   or network activity. (Requirement 8.)

2. **Fork-bomb containment.** For all programs `c` that attempt to spawn
   more than 64 child processes, executing `c` in a Submission_Container
   SHALL produce a `RUNTIME_ERROR` verdict and SHALL NOT increase the host's
   process count beyond the container's PID limit. (Requirement 9.1.)

3. **Per-submission timeout enforcement.** For all programs `c` that enter an
   infinite loop, executing `c` in a Submission_Container SHALL result in the
   container being killed within `per_submission_timeout + 5000 ms` of
   container creation, and the overall verdict SHALL be
   `TIME_LIMIT_EXCEEDED`. (Requirement 3.2.)

4. **Network isolation.** For all programs `c` that attempt to open a TCP or
   UDP connection to any destination, executing `c` in a Submission_Container
   SHALL produce a `RUNTIME_ERROR` verdict and SHALL NOT result in any
   outbound packet leaving the container. (Requirement 9.4.)

5. **Verdict determinism across modes.** For all STDIO problems `p`, correct
   programs `c`, and languages `l ∈ p.language_allowlist`, submitting
   `(p, c, l)` in local mode and Docker mode SHALL produce the same overall
   verdict (excluding TLE flakiness due to container startup). (Requirement 11.)

6. **Idempotent container cleanup.** For all submissions (successful,
   timed-out, or errored), after the Container_Lifecycle_Manager completes,
   no Docker container with the submission's container name SHALL exist on
   the host, and the host-side temporary directory SHALL not exist.
   (Requirement 1.3, Requirement 8.5.)

7. **Image pre-pull completeness.** After the Worker_Process completes
   startup in Docker mode, for all languages `l` in the configured image set,
   `docker image inspect <image_for_l>` SHALL return exit code 0.
   (Requirement 4.1.)
