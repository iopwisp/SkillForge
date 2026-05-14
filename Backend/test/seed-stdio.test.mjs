/**
 * Validate STDIO seed problems: each problem × each language in its
 * languageAllowlist → overall verdict ACCEPTED.
 *
 * Runs in default CI runtime mode (auto); gracefully skips languages
 * whose runtime is not available on the dev box.
 *
 * Requirements: R14.3
 */
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { stdioProblems } from '../src/shared/seed/stdio.js';
import { runStdioJudge } from '../src/modules/judge/stdio-exec.js';

// ---------------------------------------------------------------------------
// Runtime availability probes
//
// The STDIO judge uses specific commands per language (see stdio-prepare.js):
//   JAVASCRIPT → `node prog.js` (but reference solutions use /dev/stdin which
//                 doesn't exist on Windows)
//   PYTHON     → `python3 prog.py` (not available on Windows; uses `py -3`)
//   JAVA       → `javac` + `java`
//   GO         → `go build`
//   CPP        → `g++`
//
// We probe the exact commands that stdio-prepare.js will invoke so that
// languages whose runtime is not usable on this platform are skipped.
// ---------------------------------------------------------------------------

function probeCommand(cmd, args) {
  try {
    const res = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

function isRuntimeAvailable(language) {
  switch (language) {
    case 'JAVASCRIPT':
      // Reference solutions read stdin via readFileSync(0, 'utf8') so they
      // work on all platforms (Windows, Linux, macOS) — no '/dev/stdin' guard.
      return probeCommand('node', ['--version']);
    case 'PYTHON':
      // stdio-prepare.js hardcodes `python3` as the command
      return probeCommand('python3', ['--version']);
    case 'JAVA':
      return probeCommand('javac', ['-version']) && probeCommand('java', ['-version']);
    case 'GO':
      return probeCommand('go', ['version']);
    case 'CPP':
      return probeCommand('g++', ['--version']);
    default:
      return false;
  }
}

// Cache runtime availability so we only probe once per language
const runtimeCache = new Map();
function hasRuntime(language) {
  if (!runtimeCache.has(language)) {
    runtimeCache.set(language, isRuntimeAvailable(language));
  }
  return runtimeCache.get(language);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seed-stdio: reference solutions produce ACCEPTED', () => {
  for (const problem of stdioProblems) {
    describe(problem.slug, () => {
      for (const language of problem.languageAllowlist) {
        it(`${language} → ACCEPTED`, { skip: !hasRuntime(language) && `${language} runtime not available` }, async () => {
          const code = problem.referenceSolutions[language];
          assert.ok(code, `No reference solution for ${language}`);

          // Build the problem object matching what runStdioJudge expects
          const problemObj = {
            test_cases_json: problem.testCases,
            time_limit_ms: problem.timeLimitMs,
            memory_limit_mb: problem.memoryLimitMb,
            output_size_cap_kb: problem.outputSizeCapKb,
            comparator_mode: problem.comparatorMode,
          };

          const result = await runStdioJudge(problemObj, code, language);
          assert.equal(
            result.status,
            'ACCEPTED',
            `Expected ACCEPTED but got ${result.status} for ${problem.slug}/${language}` +
            (result.error ? `: ${result.error}` : '') +
            (result.output ? `\nOutput: ${result.output}` : ''),
          );
        });
      }
    });
  }
});
