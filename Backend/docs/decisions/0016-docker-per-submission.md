# ADR 0016 — Docker per-submission container isolation

Date: 2026-05-09

## Status

Accepted (implementation in progress)

## Context

SkillForge's STDIO judge (ADR 0015) and polyglot function judge (ADR 0014)
already support a `JUDGE_RUNTIME_MODE=docker` path that spawns ephemeral
Docker containers. The initial implementation creates a **new container per
test case** via `docker run --rm` with basic isolation flags
(`--network=none`, `--read-only`, `--memory`).

This approach has two production-grade gaps:

1. **Performance** — container startup overhead (~200–500 ms) is paid per
   test case, making a 20-test-case submission 4–10 seconds slower than
   necessary.
2. **Security** — missing PID limits, file-descriptor limits,
   `no-new-privileges`, CPU caps, and per-submission timeout enforcement.
   A malicious submission can fork-bomb, exhaust file descriptors, starve
   the host CPU, or hang the worker indefinitely.

For graded exams and contests at AITU, these gaps are unacceptable. The
platform must guarantee that one student's submission cannot affect another
student's execution, cannot escape the sandbox, and cannot degrade the host.

Full specification:
- [requirements.md](../../.kiro/specs/docker-isolation/requirements.md)
- [design.md](../../.kiro/specs/docker-isolation/design.md)

## Decision

Introduce a **Container_Lifecycle_Manager** (`modules/judge/container-manager.js`)
that consolidates the Docker lifecycle to **one container per submission**
using the `docker create` → `docker start` → `docker exec` → `docker rm -f`
pattern. Both the STDIO judge and the polyglot function judge delegate to
this single module when in Docker mode.

### One container per submission via `docker create` + `docker exec`

Instead of spawning a new container for each test case, the manager creates
one container per submission with an idle entrypoint (`tail -f /dev/null`),
copies the student source code in via `docker cp`, then uses `docker exec -i`
for compilation and each test-case execution. This eliminates repeated
container startup overhead while maintaining full isolation between
submissions.

Container naming follows the pattern `sf-judge-<submissionId>-<6-char-hex>`
for traceability and non-predictability.

### Hardened security flags

Every submission container is created with the full set of hardened flags:

| Flag | Default | Purpose |
|------|---------|---------|
| `--pids-limit` | 64 | Prevents fork bombs |
| `--cpus` | 1 | Prevents CPU starvation of other submissions |
| `--ulimit nofile` | 64:64 | Prevents file-descriptor exhaustion |
| `--security-opt=no-new-privileges` | always | Blocks privilege escalation |
| `--network=none` | always | No outbound network access |
| `--read-only` | always | Immutable root filesystem |
| `--tmpfs=/tmp:rw,noexec,nosuid,size=<N>m` | 128 MB | Writable scratch (noexec) |
| `--mount type=bind,src=<workdir>,dst=/workspace` | per submission | Per-submission writable working dir (source + compiled artifact) |
| `--memory` | per-problem | OOM kill on memory limit breach |

### Per-submission timeout

Rather than relying solely on per-test timeouts (which a malicious program
could circumvent by being slow across many tests), the manager computes an
aggregate ceiling and kills the entire container if exceeded:

```
timeout = clamp(
  time_limit_ms × test_count × 1.5 + compile_overhead_ms,
  10000,   // floor: 10 seconds
  300000   // ceiling: 5 minutes
)
```

`compile_overhead_ms` defaults to 30000 for compiled languages (Java, Go,
C++) and 0 for interpreted languages (JavaScript, Python).

### Image pre-pull on worker startup

The worker process pre-pulls all configured Docker images on boot (with a
120 s total ceiling) so the first submission after deployment does not pay
a multi-second pull penalty. Already-cached images are detected via
`docker image inspect` and skipped. Failures are logged as warnings; the
worker continues startup regardless.

### Graceful degradation

| `JUDGE_RUNTIME_MODE` | Docker available | Behaviour |
|---|---|---|
| `auto` | yes | Use Docker (container-manager) |
| `auto` | no | Fall back to local subprocess |
| `docker` | yes | Use Docker (container-manager) |
| `docker` | no | `JUDGE_ERROR`: "Docker is required but unavailable" |
| `local` | — | Local subprocess, no Docker commands |
| `off` | — | `JUDGE_ERROR`: "Judging is disabled" |

The container manager is never imported or invoked when
`JUDGE_RUNTIME_MODE=local` or `off`. All existing tests pass unchanged.

### Container_Lifecycle_Manager as single point of Docker interaction

Both `stdio-exec.js` and `runtimes.js` delegate to `container-manager.js`
when in Docker mode. This keeps the container management concern in one
place (DRY) while preserving the existing local-mode code paths untouched.

### Seccomp profile (stretch goal)

If `JUDGE_SECCOMP_PROFILE` is set to a path, the manager applies
`--security-opt seccomp=<path>` to every container. Authoring a custom
seccomp profile is out of scope for this ADR; the mechanism is provided
for operators who want to further restrict system calls.

### Environment variable overrides for operators

All hardened flags are configurable via environment variables with sensible
defaults, allowing on-prem operators to tune the sandbox without code
changes:

| Variable | Default | Description |
|---|---|---|
| `JUDGE_DOCKER_PIDS_LIMIT` | 64 | Max processes inside container |
| `JUDGE_DOCKER_CPU_LIMIT` | 1 | CPU cores allocated |
| `JUDGE_DOCKER_NOFILE_LIMIT` | 64 | Max open file descriptors |
| `JUDGE_DOCKER_TMPFS_SIZE_MB` | 128 | Writable tmpfs size in MB |
| `JUDGE_DOCKER_COMPILE_OVERHEAD_MS` | 30000 | Compile time budget |
| `JUDGE_SECCOMP_PROFILE` | _(unset)_ | Custom seccomp JSON path |

## Consequences

### Positive

- **Security**: every submission runs in a fully hardened container with
  PID limits, CPU caps, FD limits, no-new-privileges, network isolation,
  and read-only root. Fork bombs, FD exhaustion, and privilege escalation
  are blocked at the kernel level.
- **Performance**: container startup overhead is paid once per submission
  instead of once per test case. A 20-test submission saves 4–10 seconds.
- **Reliability**: per-submission timeout ensures no submission can hang
  the worker indefinitely. Image pre-pull eliminates cold-start latency.
- **Isolation**: concurrent submissions run in separate containers with
  separate PID namespaces, network namespaces, and filesystems.
- **Operability**: all limits are env-configurable; graceful degradation
  provides clear error messages when Docker is unavailable.

### Negative / costs

- **Docker dependency**: production deployments require Docker daemon on
  the worker host. Development without Docker still works via local mode.
- **Complexity**: one more module (`container-manager.js`) to maintain,
  with its own error paths and timeout logic.
- **Resource overhead**: each submission container consumes kernel
  resources (namespaces, cgroups). High-concurrency deployments need
  adequate host resources.
- **Seccomp authoring**: the seccomp profile mechanism is provided but
  authoring a production profile requires security expertise beyond this
  ADR's scope.

### Out of scope

- Custom seccomp profile authoring (mechanism provided, content is not).
- gVisor or Kata Containers as alternative sandboxes.
- Container image caching beyond the pre-pull mechanism.
- Multi-host distributed judging (single-host per ADR 0001).

## Links

- [Requirements](../../.kiro/specs/docker-isolation/requirements.md)
- [Design](../../.kiro/specs/docker-isolation/design.md)
- [ADR 0013 — Async judge pipeline](./0013-async-judge-pipeline.md)
- [ADR 0014 — Polyglot function judge](./0014-polyglot-function-judge.md)
- [ADR 0015 — STDIO judge](./0015-stdio-judge.md)
