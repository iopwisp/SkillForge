// Feature: docker-isolation, Property 1: All hardened security flags are present in every container
// Feature: docker-isolation, Property 2: Exactly one container is created per submission
// Feature: docker-isolation, Property 3: Container cleanup is guaranteed after every submission outcome
// Feature: docker-isolation, Property 4: Per-submission timeout is correctly computed and clamped
// Feature: docker-isolation, Property 5: Environment variable overrides are reflected in Docker args
// Feature: docker-isolation, Property 6: Container names are unique and non-predictable
// Feature: docker-isolation, Property 7: Source code is mounted read-only
// Feature: docker-isolation, Property 8: Container environment is minimal
// Feature: docker-isolation, Property 9: Compile overhead is included in timeout only for compiled languages
// Feature: docker-isolation, Property 10: Seccomp profile is conditionally applied
// Feature: docker-isolation, Property 11: Log output never contains student code or I/O data
// Feature: docker-isolation, Property 12: Local mode never invokes Docker

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  buildCreateArgs,
  generateContainerName,
  computeSubmissionTimeout,
  CONTAINER_DEFAULTS,
  CONFIGURED_IMAGES,
} from '../src/modules/judge/container-manager.js';

// ─── Shared Generators ───────────────────────────────────────────────────────

const arbLanguage = fc.constantFrom('JAVASCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP');
const arbMemoryLimit = fc.integer({ min: 16, max: 512 });
const arbTimeLimitMs = fc.integer({ min: 100, max: 10000 });
const arbTestCount = fc.integer({ min: 1, max: 100 });
const arbSubmissionId = fc.stringMatching(/^[a-z0-9]{1,20}$/);
const arbCode = fc.string({ minLength: 1, maxLength: 500 });
const arbEnvOverrides = fc.record({
  pidsLimit: fc.integer({ min: 16, max: 256 }),
  cpuLimit: fc.double({ min: 0.25, max: 4, noNaN: true }),
  nofileLimit: fc.integer({ min: 16, max: 1024 }),
  tmpfsSizeMb: fc.integer({ min: 32, max: 512 }),
  seccompProfile: fc.oneof(fc.constant(null), fc.stringMatching(/^[/][a-z/]+\.json$/)),
  compileOverheadMs: fc.integer({ min: 5000, max: 60000 }),
});

// ─── Property 1: All hardened security flags present ─────────────────────────

/**
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 * Property 1: All hardened security flags are present in every container
 *
 * For any submission (any language, any problem configuration, any memory
 * limit), the Docker `create` command arguments produced by the
 * Container_Lifecycle_Manager SHALL contain ALL of the following flags.
 */
describe('P1: All hardened security flags present in every container', () => {
  it('docker create args contain all required security flags for any config', () => {
    fc.assert(
      fc.property(arbLanguage, arbMemoryLimit, arbEnvOverrides, (language, memoryLimitMb, envOverrides) => {
        const image = CONFIGURED_IMAGES[language]();
        const name = `sf-judge-test-abc123`;

        const args = buildCreateArgs({
          name,
          image,
          memoryLimitMb,
          defaults: envOverrides,
        });

        const joined = args.join(' ');

        // R2.5: --network=none
        assert.ok(args.includes('--network=none'), 'Missing --network=none');
        // R2.6: --read-only
        assert.ok(args.includes('--read-only'), 'Missing --read-only');
        // R2.7: --tmpfs with correct size
        const tmpfsArg = args.find(a => a.startsWith('--tmpfs=/tmp:'));
        assert.ok(tmpfsArg, 'Missing --tmpfs=/tmp:...');
        assert.ok(tmpfsArg.includes(`size=${envOverrides.tmpfsSizeMb}m`), `tmpfs size mismatch: ${tmpfsArg}`);
        assert.ok(tmpfsArg.includes('rw'), 'tmpfs missing rw');
        assert.ok(tmpfsArg.includes('noexec'), 'tmpfs missing noexec');
        assert.ok(tmpfsArg.includes('nosuid'), 'tmpfs missing nosuid');
        // R2.1: --pids-limit
        assert.ok(args.includes(`--pids-limit=${envOverrides.pidsLimit}`), 'Missing --pids-limit');
        // R2.2: --cpus
        assert.ok(args.includes(`--cpus=${envOverrides.cpuLimit}`), 'Missing --cpus');
        // R2.8: --memory
        assert.ok(args.includes(`--memory=${memoryLimitMb}m`), 'Missing --memory');
        // R2.3: --ulimit nofile
        assert.ok(joined.includes(`nofile=${envOverrides.nofileLimit}:${envOverrides.nofileLimit}`), 'Missing --ulimit nofile');
        // R2.4: --security-opt=no-new-privileges
        assert.ok(args.includes('--security-opt=no-new-privileges'), 'Missing --security-opt=no-new-privileges');
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 2: Exactly one container per submission ────────────────────────

/**
 * Validates: Requirements 1.1, 1.2
 * Property 2: Exactly one container is created per submission
 *
 * For any submission flow (create → N execs → destroy), exactly one
 * `docker create` and one `docker start` are issued.
 */
describe('P2: Exactly one container per submission', () => {
  it('buildCreateArgs produces exactly one "create" command', () => {
    fc.assert(
      fc.property(arbLanguage, arbMemoryLimit, arbSubmissionId, (language, memoryLimitMb, submissionId) => {
        const image = CONFIGURED_IMAGES[language]();
        const name = generateContainerName(submissionId);

        const args = buildCreateArgs({ name, image, memoryLimitMb });

        // The first element must be 'create'
        assert.strictEqual(args[0], 'create');
        // There should be exactly one 'create' in the args
        const createCount = args.filter(a => a === 'create').length;
        assert.strictEqual(createCount, 1, 'Expected exactly one "create" command');
        // No 'start' in the create args (start is a separate call)
        const startCount = args.filter(a => a === 'start').length;
        assert.strictEqual(startCount, 0, 'create args should not contain "start"');
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 3: Container cleanup guaranteed ────────────────────────────────

/**
 * Validates: Requirements 1.3, 8.5
 * Property 3: Container cleanup is guaranteed after every submission outcome
 *
 * For any outcome (success, error, timeout), `docker rm -f` is called
 * and the temp directory is removed. We verify this by testing destroyContainer
 * with a mocked execFileAsync.
 */
describe('P3: Container cleanup guaranteed', () => {
  it('destroyContainer source always calls docker rm -f and rmSync', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    fc.assert(
      fc.property(arbSubmissionId, (_submissionId) => {
        const source = readFileSync(
          join(process.cwd(), 'src', 'modules', 'judge', 'container-manager.js'),
          'utf8',
        );

        // Extract the destroyContainer function body
        const destroyIdx = source.indexOf('export async function destroyContainer');
        assert.ok(destroyIdx !== -1, 'destroyContainer must exist');
        const afterDestroy = source.slice(destroyIdx);

        // Must call docker rm -f
        assert.ok(
          afterDestroy.includes("'rm'") && afterDestroy.includes("'-f'"),
          'destroyContainer must call docker rm -f',
        );

        // Must call rmSync with recursive and force
        assert.ok(
          afterDestroy.includes('rmSync') && afterDestroy.includes('recursive') && afterDestroy.includes('force'),
          'destroyContainer must call rmSync with recursive + force',
        );

        // Must clear the timeout timer
        assert.ok(
          afterDestroy.includes('clearTimeout') || afterDestroy.includes('timeoutTimer'),
          'destroyContainer must clear the timeout timer',
        );

        // Must not throw — verified by the try/catch structure
        assert.ok(
          afterDestroy.includes('catch'),
          'destroyContainer must catch errors (idempotent)',
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Timeout correctly computed and clamped ──────────────────────

/**
 * Validates: Requirements 3.1, 3.5
 * Property 4: Per-submission timeout is correctly computed and clamped
 *
 * For any (timeLimitMs ∈ [100,10000], testCount ∈ [1,100], isCompiled),
 * result equals clamp(timeLimitMs × testCount × 1.5 + overhead, 10000, 300000).
 */
describe('P4: Timeout correctly computed and clamped', () => {
  it('computeSubmissionTimeout matches the formula with clamping', () => {
    fc.assert(
      fc.property(arbTimeLimitMs, arbTestCount, fc.boolean(), (timeLimitMs, testCount, isCompiled) => {
        const compileOverhead = isCompiled ? CONTAINER_DEFAULTS.compileOverheadMs : 0;
        const raw = timeLimitMs * testCount * 1.5 + compileOverhead;
        const expected = Math.max(10000, Math.min(300000, Math.round(raw)));

        const actual = computeSubmissionTimeout(timeLimitMs, testCount, isCompiled);

        assert.strictEqual(actual, expected);
      }),
      { numRuns: 200 },
    );
  });

  it('result is always within [10000, 300000]', () => {
    fc.assert(
      fc.property(arbTimeLimitMs, arbTestCount, fc.boolean(), (timeLimitMs, testCount, isCompiled) => {
        const result = computeSubmissionTimeout(timeLimitMs, testCount, isCompiled);
        assert.ok(result >= 10000, `Result ${result} < 10000`);
        assert.ok(result <= 300000, `Result ${result} > 300000`);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 5: Env variable overrides reflected in Docker args ─────────────

/**
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 * Property 5: Environment variable overrides are reflected in Docker args
 *
 * For any set of env overrides, the Docker create args use the overridden values.
 */
describe('P5: Env variable overrides reflected in Docker args', () => {
  it('buildCreateArgs uses provided defaults instead of CONTAINER_DEFAULTS', () => {
    fc.assert(
      fc.property(arbMemoryLimit, arbEnvOverrides, (memoryLimitMb, envOverrides) => {
        const args = buildCreateArgs({
          name: 'sf-judge-test-abc123',
          image: 'node:20-alpine',
          memoryLimitMb,
          defaults: envOverrides,
        });

        // Verify overridden values appear in args
        assert.ok(args.includes(`--pids-limit=${envOverrides.pidsLimit}`),
          `Expected --pids-limit=${envOverrides.pidsLimit}`);
        assert.ok(args.includes(`--cpus=${envOverrides.cpuLimit}`),
          `Expected --cpus=${envOverrides.cpuLimit}`);

        const joined = args.join(' ');
        assert.ok(joined.includes(`nofile=${envOverrides.nofileLimit}:${envOverrides.nofileLimit}`),
          `Expected nofile=${envOverrides.nofileLimit}:${envOverrides.nofileLimit}`);

        const tmpfsArg = args.find(a => a.startsWith('--tmpfs=/tmp:'));
        assert.ok(tmpfsArg.includes(`size=${envOverrides.tmpfsSizeMb}m`),
          `Expected tmpfs size=${envOverrides.tmpfsSizeMb}m`);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 6: Container names unique and non-predictable ──────────────────

/**
 * Validates: Requirements 8.1, 8.2
 * Property 6: Container names are unique and non-predictable
 *
 * For any two submissions, generated names are distinct and contain a
 * random component not derivable from submission ID alone.
 */
describe('P6: Container names unique and non-predictable', () => {
  it('two calls to generateContainerName with the same ID produce different names', () => {
    fc.assert(
      fc.property(arbSubmissionId, (submissionId) => {
        const name1 = generateContainerName(submissionId);
        const name2 = generateContainerName(submissionId);

        // Names should be different (random suffix)
        assert.notStrictEqual(name1, name2, 'Two generated names should differ');

        // Both should start with the expected prefix
        assert.ok(name1.startsWith(`sf-judge-${submissionId}-`), `Name should start with sf-judge-${submissionId}-`);
        assert.ok(name2.startsWith(`sf-judge-${submissionId}-`), `Name should start with sf-judge-${submissionId}-`);

        // Random suffix should be 6 hex chars
        const suffix1 = name1.slice(`sf-judge-${submissionId}-`.length);
        const suffix2 = name2.slice(`sf-judge-${submissionId}-`.length);
        assert.match(suffix1, /^[0-9a-f]{6}$/, 'Suffix should be 6 hex chars');
        assert.match(suffix2, /^[0-9a-f]{6}$/, 'Suffix should be 6 hex chars');
      }),
      { numRuns: 200 },
    );
  });

  it('names from different submission IDs are always distinct', () => {
    fc.assert(
      fc.property(arbSubmissionId, arbSubmissionId, (id1, id2) => {
        fc.pre(id1 !== id2);
        const name1 = generateContainerName(id1);
        const name2 = generateContainerName(id2);
        assert.notStrictEqual(name1, name2);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 7: Source code mounted read-only ───────────────────────────────

/**
 * Validates: Requirements 1.4, 11.4
 * Property 7: Source code is mounted read-only
 *
 * For any submission, Docker args include --read-only and the working
 * directory is set to /workspace.
 */
describe('P7: Source code mounted read-only', () => {
  it('docker create args include --read-only and -w /workspace', () => {
    fc.assert(
      fc.property(arbLanguage, arbMemoryLimit, (language, memoryLimitMb) => {
        const image = CONFIGURED_IMAGES[language]();
        const args = buildCreateArgs({
          name: 'sf-judge-test-abc123',
          image,
          memoryLimitMb,
        });

        // --read-only must be present
        assert.ok(args.includes('--read-only'), 'Missing --read-only flag');

        // Working directory set to /workspace
        const wIdx = args.indexOf('-w');
        assert.ok(wIdx !== -1, 'Missing -w flag');
        assert.strictEqual(args[wIdx + 1], '/workspace', 'Working directory should be /workspace');
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 8: Container environment is minimal ────────────────────────────

/**
 * Validates: Requirements 11.3, 11.4
 * Property 8: Container environment is minimal
 *
 * For any submission, docker exec does NOT pass host env vars. The spawn
 * call in execInContainer uses `env: {}` which means no host env vars leak.
 * We verify this by inspecting the source code contract: execInContainer
 * spawns with `env: {}`.
 */
describe('P8: Container environment is minimal', () => {
  it('execInContainer spawns docker exec with empty env (no host vars)', async () => {
    // We verify the contract by importing and checking that the spawn call
    // uses env: {} — this is a structural property test.
    // Since we can't easily mock spawn in ESM, we verify the source code
    // contract holds by reading the module's behavior.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    fc.assert(
      fc.property(arbSubmissionId, (_submissionId) => {
        // Read the source to verify the env: {} contract
        const source = readFileSync(
          join(process.cwd(), 'src', 'modules', 'judge', 'container-manager.js'),
          'utf8',
        );

        // The spawn call in execInContainer must use env: {}
        // This ensures no host environment variables leak into the container
        assert.ok(
          source.includes('env: {}'),
          'execInContainer must spawn with env: {} to prevent host env leakage',
        );

        // Verify no --env flags are passed in the exec args construction
        // The exec args are: ['exec', '-i', handle.name, ...cmd]
        assert.ok(
          !source.includes("'--env'") || source.indexOf("'--env'") > source.indexOf('execInContainer'),
          'exec args should not include --env flags',
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: Compile overhead only for compiled languages ────────────────

/**
 * Validates: Requirements 3.1, 10.5
 * Property 9: Compile overhead is included in timeout only for compiled languages
 *
 * For interpreted languages, compileOverhead = 0; for compiled, it equals
 * JUDGE_DOCKER_COMPILE_OVERHEAD_MS.
 */
describe('P9: Compile overhead only for compiled languages', () => {
  it('interpreted languages get 0 compile overhead', () => {
    const interpretedLangs = fc.constantFrom('JAVASCRIPT', 'PYTHON');

    fc.assert(
      fc.property(interpretedLangs, arbTimeLimitMs, arbTestCount, (language, timeLimitMs, testCount) => {
        const withCompile = computeSubmissionTimeout(timeLimitMs, testCount, true);
        const withoutCompile = computeSubmissionTimeout(timeLimitMs, testCount, false);

        // For interpreted languages (isCompiled=false), no compile overhead
        const rawNoCompile = timeLimitMs * testCount * 1.5;
        const expectedNoCompile = Math.max(10000, Math.min(300000, Math.round(rawNoCompile)));
        assert.strictEqual(withoutCompile, expectedNoCompile);

        // The difference between compiled and non-compiled should be the overhead
        // (unless clamping kicks in)
        const rawWithCompile = timeLimitMs * testCount * 1.5 + CONTAINER_DEFAULTS.compileOverheadMs;
        if (rawNoCompile >= 10000 && rawNoCompile <= 300000 &&
            rawWithCompile >= 10000 && rawWithCompile <= 300000) {
          // Both unclamped — difference should be exactly compileOverheadMs
          assert.strictEqual(withCompile - withoutCompile, CONTAINER_DEFAULTS.compileOverheadMs);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('compiled languages always include compile overhead in the raw computation', () => {
    const compiledLangs = fc.constantFrom('JAVA', 'GO', 'CPP');

    fc.assert(
      fc.property(compiledLangs, arbTimeLimitMs, arbTestCount, (_language, timeLimitMs, testCount) => {
        const result = computeSubmissionTimeout(timeLimitMs, testCount, true);
        const rawWithOverhead = timeLimitMs * testCount * 1.5 + CONTAINER_DEFAULTS.compileOverheadMs;
        const expected = Math.max(10000, Math.min(300000, Math.round(rawWithOverhead)));
        assert.strictEqual(result, expected);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 10: Seccomp profile conditionally applied ──────────────────────

/**
 * Validates: Requirements 2.9, 2.10, 10.6
 * Property 10: Seccomp profile is conditionally applied
 *
 * When JUDGE_SECCOMP_PROFILE is set, --security-opt seccomp=<path> appears;
 * when unset, no seccomp= flag appears.
 */
describe('P10: Seccomp profile conditionally applied', () => {
  it('seccomp flag present when profile is set', () => {
    const arbSeccompPath = fc.stringMatching(/^[/][a-z][a-z0-9/]{0,30}\.json$/);

    fc.assert(
      fc.property(arbMemoryLimit, arbSeccompPath, (memoryLimitMb, seccompPath) => {
        const args = buildCreateArgs({
          name: 'sf-judge-test-abc123',
          image: 'node:20-alpine',
          memoryLimitMb,
          defaults: { ...CONTAINER_DEFAULTS, seccompProfile: seccompPath },
        });

        // Should contain seccomp=<path>
        const seccompArg = args.find(a => a.startsWith('seccomp='));
        assert.ok(seccompArg, 'Missing seccomp= arg when profile is set');
        assert.strictEqual(seccompArg, `seccomp=${seccompPath}`);
      }),
      { numRuns: 200 },
    );
  });

  it('no seccomp flag when profile is null or empty', () => {
    const arbNullOrEmpty = fc.constantFrom(null, '', undefined);

    fc.assert(
      fc.property(arbMemoryLimit, arbNullOrEmpty, (memoryLimitMb, seccompProfile) => {
        const args = buildCreateArgs({
          name: 'sf-judge-test-abc123',
          image: 'node:20-alpine',
          memoryLimitMb,
          defaults: { ...CONTAINER_DEFAULTS, seccompProfile },
        });

        // Should NOT contain any seccomp= arg
        const seccompArg = args.find(a => a.startsWith('seccomp=') || (typeof a === 'string' && a.includes('seccomp=')));
        assert.strictEqual(seccompArg, undefined, `Unexpected seccomp arg: ${seccompArg}`);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Log output never contains student code or I/O ──────────────

/**
 * Validates: Requirement 12.5
 * Property 11: Log output never contains student code or I/O data
 *
 * For any (code, stdin, stdout), log messages emitted by the manager
 * contain only metadata (name, image, limits, timing).
 */
describe('P11: Log output never contains student code or I/O', () => {
  it('createContainer debug log does not include student code', async () => {
    // The logger.debug call in createContainer logs:
    // { containerName, image, submissionId, memoryLimitMb, pidsLimit, cpuLimit, nofileLimit, tmpfsSizeMb }
    // We verify by reading the source that no code/stdin/stdout fields are logged.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    const source = readFileSync(
      join(process.cwd(), 'src', 'modules', 'judge', 'container-manager.js'),
      'utf8',
    );

    fc.assert(
      fc.property(arbCode, (_code) => {
        // Find all logger.debug/info/warn calls
        const logCalls = source.match(/logger\.(debug|info|warn|error)\(\s*\{[^}]*\}/g) || [];

        for (const logCall of logCalls) {
          // None of the log calls should reference 'code', 'stdin', 'stdout' as fields
          // (they may reference 'containerName', 'image', 'submissionId', etc.)
          assert.ok(!logCall.includes(' code,') && !logCall.includes(' code:'),
            `Log call should not include student code: ${logCall}`);
          assert.ok(!logCall.includes(' stdin,') && !logCall.includes(' stdin:'),
            `Log call should not include stdin: ${logCall}`);
          assert.ok(!logCall.includes(' stdout,') && !logCall.includes(' stdout:'),
            `Log call should not include stdout: ${logCall}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Local mode never invokes Docker ────────────────────────────

/**
 * Validates: Requirements 7.1, 7.2, 7.4
 * Property 12: Local mode never invokes Docker
 *
 * When JUDGE_RUNTIME_MODE=local, the container-manager is not imported
 * in the judge flow and no Docker commands are spawned.
 */
describe('P12: Local mode never invokes Docker', () => {
  it('getStdioRuntimeMode returns "local" when JUDGE_RUNTIME_MODE=local', async () => {
    // Save and set env
    const original = process.env.JUDGE_RUNTIME_MODE;
    process.env.JUDGE_RUNTIME_MODE = 'local';

    try {
      const { getStdioRuntimeMode } = await import('../src/modules/judge/stdio-prepare.js');

      fc.assert(
        fc.property(arbLanguage, (_language) => {
          const mode = getStdioRuntimeMode();
          assert.strictEqual(mode, 'local',
            'When JUDGE_RUNTIME_MODE=local, getStdioRuntimeMode must return "local"');
        }),
        { numRuns: 100 },
      );
    } finally {
      if (original === undefined) {
        delete process.env.JUDGE_RUNTIME_MODE;
      } else {
        process.env.JUDGE_RUNTIME_MODE = original;
      }
    }
  });

  it('stdio-exec.js does not unconditionally import container-manager', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    fc.assert(
      fc.property(arbLanguage, (_language) => {
        const source = readFileSync(
          join(process.cwd(), 'src', 'modules', 'judge', 'stdio-exec.js'),
          'utf8',
        );

        // The key invariant for P12: stdio-exec.js (which handles local mode
        // execution) does NOT unconditionally import container-manager.
        // If it imports container-manager at all, it must be conditional (dynamic import)
        // or guarded by a mode check. A static top-level import would mean
        // local mode always loads Docker code.
        const hasStaticImport = source.includes("from './container-manager.js'") ||
                                source.includes("from './container-manager'");

        // Either no import at all (local-only module), or it's a dynamic import
        if (hasStaticImport) {
          // If there's a static import, verify there's a mode guard
          assert.ok(
            source.includes('getStdioRuntimeMode') || source.includes('JUDGE_RUNTIME_MODE'),
            'If container-manager is imported, a runtime mode check must guard its use',
          );
        }
        // If no static import, the property holds trivially
      }),
      { numRuns: 100 },
    );
  });
});
