import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createContainer,
  execInContainer,
  destroyContainer,
  computeSubmissionTimeout,
} from './container-manager.js';

const DEFAULT_TIME_LIMIT_MS = 2000;
const COMPILE_TIMEOUT_MS = 30_000;
const DOCKER_MEMORY_MB = 128;

const RUNTIME_ALIASES = {
  python: 'python',
  python3: 'python',
  py: 'python',
  java: 'java',
  go: 'go',
  golang: 'go',
  cpp: 'cpp',
  'c++': 'cpp',
};

const DOCKER_IMAGES = {
  python: () => process.env.JUDGE_PYTHON_IMAGE || 'python:3.12-alpine',
  java: () => process.env.JUDGE_JAVA_IMAGE || 'eclipse-temurin:21-jdk-alpine',
  go: () => process.env.JUDGE_GO_IMAGE || 'golang:1.23-alpine',
  cpp: () => process.env.JUDGE_CPP_IMAGE || 'gcc:13-bookworm',
};

export function normalizeExternalLanguage(language) {
  return RUNTIME_ALIASES[String(language || '').trim().toLowerCase()] || null;
}

export function hasExternalRuntime(language) {
  const lang = normalizeExternalLanguage(language);
  if (!lang) return false;
  const local = localRuntime(lang);
  if (local) return true;
  return dockerImageAvailable(lang);
}

export function runPythonJudge(problem, code) {
  return runExternalJudge('python', problem, code);
}

export function runJavaJudge(problem, code) {
  return runExternalJudge('java', problem, code);
}

export function runGoJudge(problem, code) {
  return runExternalJudge('go', problem, code);
}

function runExternalJudge(language, problem, code) {
  const tests = safeJson(problem.test_cases_json, []);
  const fnName = problem.function_name;
  if (!Array.isArray(tests) || tests.length === 0 || !fnName) return verdictNoTests();
  if ((code || '').trim().length < 5) {
    return wrongAnswer({ tests, runtimeMs: 1, output: 'Empty submission.' });
  }

  const lang = normalizeExternalLanguage(language);
  const runtime = resolveRuntime(lang);
  if (!runtime) {
    return compileError({
      tests,
      error: `${labelFor(lang || language)} runtime is not available. Install it locally or enable Docker-based judging.`,
    });
  }

  if (runtime.kind === 'docker') {
    return runExternalJudgeDocker(lang, problem, code, tests, fnName);
  }

  return runExternalJudgeLocal(lang, problem, code, tests, runtime);
}

function runExternalJudgeLocal(lang, problem, code, tests, runtime) {
  const dir = mkdtempSync(path.join(tmpdir(), 'skillforge-judge-'));
  const t0 = Date.now();
  try {
    const prepared = prepareRuntime(lang, dir, problem, code, tests);
    const compile = prepared.compile ? runStep(runtime, prepared.compile, dir, COMPILE_TIMEOUT_MS) : null;
    if (compile && compile.timedOut) return tle({ tests, passed: 0, problem });
    if (compile && compile.status !== 0) {
      return compileError({ tests, error: trimProcessOutput(compile) || 'Compilation failed.' });
    }

    const run = runStep(runtime, prepared.run, dir, Math.max(1000, problem.time_limit_ms || DEFAULT_TIME_LIMIT_MS));
    const records = parseRuntimeOutput(run.stdout);
    const passedBeforeTimeout = countPassedRecords(records, tests);
    if (run.timedOut) return tle({ tests, passed: passedBeforeTimeout, problem });
    if (run.status !== 0 && records.length === 0) {
      return runtimeError({ tests, error: trimProcessOutput(run) || 'Runtime failed.' });
    }

    return finishExternalVerdict({ tests, records, t0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runExternalJudgeDocker(lang, problem, code, tests, _fnName) {
  const dir = mkdtempSync(path.join(tmpdir(), 'skillforge-judge-'));
  const t0 = Date.now();
  const prepared = prepareRuntime(lang, dir, problem, code, tests);
  const image = DOCKER_IMAGES[lang]();
  const timeout = computeSubmissionTimeout(
    problem.time_limit_ms || DEFAULT_TIME_LIMIT_MS,
    tests.length,
    !!prepared.compile,
  );

  let handle;
  try {
    handle = await createContainer({
      image,
      workdir: dir,
      memoryLimitMb: prepared.compile?.memoryMb || DOCKER_MEMORY_MB,
      submissionId: String(problem.id || 'polyglot'),
      timeoutMs: timeout,
    });

    // Compile step
    if (prepared.compile) {
      const compile = await execInContainer(handle, prepared.compile.dockerArgs, {
        timeoutMs: COMPILE_TIMEOUT_MS,
        env: prepared.compile.dockerEnv,
      });
      if (compile.exit !== 0) {
        return compileError({ tests, error: compile.stderr || 'Compilation failed.' });
      }
    }

    // Run step
    const run = await execInContainer(handle, prepared.run.dockerArgs, {
      timeoutMs: Math.max(1000, problem.time_limit_ms || DEFAULT_TIME_LIMIT_MS) + 500,
      env: prepared.run.dockerEnv,
    });

    if (run.killedReason === 'TLE') {
      const records = parseRuntimeOutput(run.stdout);
      return tle({ tests, passed: countPassedRecords(records, tests), problem });
    }
    if (run.exit !== 0 && !run.stdout.trim()) {
      return runtimeError({ tests, error: run.stderr || 'Runtime failed.' });
    }

    const records = parseRuntimeOutput(run.stdout);
    return finishExternalVerdict({ tests, records, t0 });
  } catch (err) {
    if (err.code === 'CONTAINER_START_ERROR') {
      return compileError({ tests, error: err.message });
    }
    return runtimeError({ tests, error: err.message || 'Unknown error' });
  } finally {
    if (handle) await destroyContainer(handle);
    else rmSync(dir, { recursive: true, force: true });
  }
}

function prepareRuntime(language, dir, problem, code, tests) {
  if (language === 'python') return preparePython(dir, problem, code, tests);
  if (language === 'java') return prepareJava(dir, problem, code, tests);
  if (language === 'go') return prepareGo(dir, problem, code, tests);
  throw new Error(`Unsupported external language: ${language}`);
}

function preparePython(dir, problem, code, tests) {
  writeFileSync(path.join(dir, 'solution.py'), code);
  writeFileSync(path.join(dir, 'runner.py'), `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("solution", "solution.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
fn = getattr(mod, ${JSON.stringify(problem.function_name)}, None)
if not callable(fn) and hasattr(mod, "Solution"):
    instance = mod.Solution()
    fn = getattr(instance, ${JSON.stringify(problem.function_name)}, None)
if not callable(fn):
    raise Exception("Could not find function ${escapeForPython(problem.function_name)}")
tests = json.loads(${JSON.stringify(JSON.stringify(tests))})
for tc in tests:
    args = tc.get("args", [])
    if not isinstance(args, list):
        args = [args]
    try:
        actual = fn(*args)
        print(json.dumps({"actual": actual}, separators=(",", ":")), flush=True)
    except BaseException as e:
        print(json.dumps({"error": type(e).__name__ + ": " + str(e)}, separators=(",", ":")), flush=True)
`);
  return { run: { language: 'python', localArgs: pythonLocalArgs('runner.py'), dockerArgs: ['python3', '/workspace/runner.py'] } };
}

function prepareJava(dir, problem, code, tests) {
  writeFileSync(path.join(dir, 'Solution.java'), code);
  writeFileSync(path.join(dir, 'Runner.java'), javaRunnerSource(problem.function_name, tests));
  return {
    compile: {
      language: 'java',
      localArgs: ['javac', 'Solution.java', 'Runner.java'],
      dockerArgs: ['javac', '/workspace/Solution.java', '/workspace/Runner.java'],
    },
    run: {
      language: 'java',
      localArgs: ['java', '-cp', dir, 'Runner'],
      dockerArgs: ['java', '-cp', '/workspace', 'Runner'],
    },
  };
}

function prepareGo(dir, problem, code, tests) {
  const source = /^\s*package\s+main\b/.test(code) ? code : `package main\n\n${code}`;
  const localBin = process.platform === 'win32' ? 'solution-runner.exe' : 'solution-runner';
  writeFileSync(path.join(dir, 'solution.go'), source);
  writeFileSync(path.join(dir, 'runner.go'), goRunnerSource(problem.function_name, tests));
  return {
    compile: {
      language: 'go',
      localArgs: ['go', 'build', '-o', localBin, 'solution.go', 'runner.go'],
      dockerArgs: ['go', 'build', '-o', '/workspace/solution-runner', '/workspace/solution.go', '/workspace/runner.go'],
      env: { GOCACHE: path.join(dir, 'gocache') },
      dockerEnv: ['GOCACHE=/tmp/gocache'],
      memoryMb: 512,
      tmpMb: 256,
    },
    run: {
      language: 'go',
      localArgs: [path.join(dir, localBin)],
      dockerArgs: ['/workspace/solution-runner'],
    },
  };
}

function runStep(runtime, step, dir, timeoutMs) {
  if (runtime.kind === 'local') {
    const [cmd, ...args] = step.localArgs;
    return spawn(cmd, args, {
      cwd: dir,
      timeoutMs: timeoutMs + 500,
      env: { ...minimalEnv(), ...(step.env || {}) },
    });
  }

  const args = dockerArgs(step, dir);
  return spawn('docker', args, {
    cwd: dir,
    timeoutMs: timeoutMs + 10_000,
    env: minimalEnv(),
  });
}

function dockerArgs(step, dir) {
  const envArgs = (step.dockerEnv || []).flatMap(pair => ['-e', pair]);
  const memoryMb = step.memoryMb || DOCKER_MEMORY_MB;
  const tmpMb = step.tmpMb || 64;
  return [
    'run', '--rm',
    '--network', 'none',
    '--memory', `${memoryMb}m`,
    '--cpus', '1',
    '--pids-limit', '256',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${tmpMb}m`,
    ...envArgs,
    '-v', `${dir}:/workspace`,
    '-w', '/workspace',
    DOCKER_IMAGES[step.language](),
    ...step.dockerArgs,
  ];
}

function resolveRuntime(language) {
  const mode = process.env.JUDGE_RUNTIME_MODE || 'auto';
  if (mode === 'off') return null;
  if (mode !== 'docker') {
    const local = localRuntime(language);
    if (local) return { kind: 'local', local };
  }
  if (mode === 'local') return null;
  if (mode === 'docker' || dockerImageAvailable(language)) return { kind: 'docker' };
  return null;
}

function localRuntime(language) {
  if (language === 'python') {
    if (commandOk('py', ['-3', '--version'])) return { command: 'py' };
    if (commandOk('python3', ['--version'])) return { command: 'python3' };
    if (commandOk('python', ['--version'])) return { command: 'python' };
  }
  if (language === 'java') {
    if (commandOk('javac', ['-version']) && commandOk('java', ['-version'])) return { command: 'java' };
  }
  if (language === 'go') {
    if (commandOk('go', ['version'])) return { command: 'go' };
  }
  if (language === 'cpp') {
    if (commandOk('g++', ['--version'])) return { command: 'g++' };
  }
  return null;
}

function pythonLocalArgs(script) {
  if (commandOk('py', ['-3', '--version'])) return ['py', '-3', script];
  if (commandOk('python3', ['--version'])) return ['python3', script];
  return ['python', script];
}

function dockerImageAvailable(language) {
  if (!commandOk('docker', ['--version'])) return false;
  const res = spawn('docker', ['image', 'inspect', DOCKER_IMAGES[language]()], {
    timeoutMs: 3000,
    env: minimalEnv(),
  });
  return res.status === 0;
}

function commandOk(cmd, args) {
  const res = spawn(cmd, args, { timeoutMs: 3000, env: minimalEnv() });
  return res.status === 0;
}

function spawn(cmd, args, { cwd, timeoutMs, env } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return {
    status: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    timedOut: res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM',
    error: res.error,
  };
}

function minimalEnv() {
  const env = {};
  for (const k of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'TMP', 'TEMP']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

function javaRunnerSource(fnName, tests) {
  const calls = tests.map(tc => {
    const args = Array.isArray(tc.args) ? tc.args : [tc.args];
    return `emit(() -> solution.${fnName}(${args.map(javaLiteral).join(', ')}));`;
  }).join('\n    ');

  return `
import java.lang.reflect.Array;
import java.util.*;

public class Runner {
  interface Call { Object call() throws Exception; }

  public static void main(String[] args) throws Exception {
    Solution solution = new Solution();
    ${calls}
  }

  static void emit(Call call) {
    try {
      System.out.println("{\\"actual\\":" + json(call.call()) + "}");
    } catch (Throwable t) {
      Throwable e = t instanceof java.lang.reflect.InvocationTargetException ? t.getCause() : t;
      System.out.println("{\\"error\\":" + quote(e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage())) + "}");
    }
    System.out.flush();
  }

  static Map<String, Object> map(Object... values) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i + 1 < values.length; i += 2) out.put(String.valueOf(values[i]), values[i + 1]);
    return out;
  }

  static List<Object> list(Object... values) {
    return new ArrayList<>(Arrays.asList(values));
  }

  static String json(Object value) {
    if (value == null) return "null";
    if (value instanceof String || value instanceof Character) return quote(String.valueOf(value));
    if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
    Class<?> cls = value.getClass();
    if (cls.isArray()) {
      List<String> parts = new ArrayList<>();
      int n = Array.getLength(value);
      for (int i = 0; i < n; i++) parts.add(json(Array.get(value, i)));
      return "[" + String.join(",", parts) + "]";
    }
    if (value instanceof Map<?, ?> mapValue) {
      List<String> parts = new ArrayList<>();
      for (Map.Entry<?, ?> e : mapValue.entrySet()) parts.add(quote(String.valueOf(e.getKey())) + ":" + json(e.getValue()));
      return "{" + String.join(",", parts) + "}";
    }
    if (value instanceof Iterable<?> iterable) {
      List<String> parts = new ArrayList<>();
      for (Object item : iterable) parts.add(json(item));
      return "[" + String.join(",", parts) + "]";
    }
    return quote(String.valueOf(value));
  }

  static String quote(String s) {
    StringBuilder out = new StringBuilder("\\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '\\\\') out.append("\\\\\\\\");
      else if (c == '"') out.append("\\\\\\"");
      else if (c == '\\n') out.append("\\\\n");
      else if (c == '\\r') out.append("\\\\r");
      else if (c == '\\t') out.append("\\\\t");
      else if (c < 32) out.append(String.format("\\\\u%04x", (int)c));
      else out.append(c);
    }
    return out.append('"').toString();
  }
}
`;
}

function goRunnerSource(fnName, tests) {
  const calls = tests.map(tc => {
    const args = Array.isArray(tc.args) ? tc.args : [tc.args];
    return `emit(func() any { return ${fnName}(${args.map(goLiteral).join(', ')}) })`;
  }).join('\n    ');

  return `
package main

import (
  "encoding/json"
  "fmt"
)

func emit(call func() any) {
  defer func() {
    if r := recover(); r != nil {
      b, _ := json.Marshal(map[string]any{"error": fmt.Sprint(r)})
      fmt.Println(string(b))
    }
  }()
  b, _ := json.Marshal(map[string]any{"actual": call()})
  fmt.Println(string(b))
}

func main() {
  ${calls}
}
`;
}

function javaLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : `${value}d`;
  if (Array.isArray(value)) return `list(${value.map(javaLiteral).join(', ')})`;
  if (typeof value === 'object') {
    return `map(${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}, ${javaLiteral(v)}`).join(', ')})`;
  }
  return JSON.stringify(String(value));
}

function goLiteral(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (Array.isArray(value)) {
    return `[]any{${value.map(goLiteral).join(', ')}}`;
  }
  if (typeof value === 'object') {
    return `map[string]any{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${goLiteral(v)}`).join(', ')}}`;
  }
  return JSON.stringify(String(value));
}

function parseRuntimeOutput(stdout) {
  return stdout.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return { error: `Invalid runner output: ${line.slice(0, 200)}` }; }
    });
}

function countPassedRecords(records, tests) {
  let passed = 0;
  for (let i = 0; i < records.length && i < tests.length; i++) {
    if (!records[i].error && compareWithMode(records[i].actual, tests[i].expected, tests[i].equals)) passed++;
  }
  return passed;
}

function finishExternalVerdict({ tests, records, t0 }) {
  let passed = 0;
  let firstFail = null;
  for (let i = 0; i < tests.length; i++) {
    const rec = records[i];
    if (!rec) {
      firstFail = { name: tests[i].name || `Test ${i + 1}`, error: 'No result produced.' };
      break;
    }
    if (rec.error) {
      firstFail = { name: tests[i].name || `Test ${i + 1}`, error: rec.error, args: tests[i].args };
      break;
    }
    if (compareWithMode(rec.actual, tests[i].expected, tests[i].equals)) {
      passed++;
    } else {
      firstFail = {
        name: tests[i].name || `Test ${i + 1}`,
        args: tests[i].args,
        expected: tests[i].expected,
        actual: rec.actual,
      };
      break;
    }
  }
  return finishVerdict({ tests, passed, firstFail, t0 });
}

function compareWithMode(actual, expected, mode) {
  if (mode === 'set' && Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    const a = [...actual].sort((x, y) => JSON.stringify(x) < JSON.stringify(y) ? -1 : 1);
    const b = [...expected].sort((x, y) => JSON.stringify(x) < JSON.stringify(y) ? -1 : 1);
    return deepEqual(a, b);
  }
  if (mode === 'sortedArray' && Array.isArray(actual) && Array.isArray(expected)) {
    return deepEqual([...actual].sort(), [...expected].sort());
  }
  return deepEqual(actual, expected);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!isFinite(a) || !isFinite(b)) return a === b;
    return Math.abs(a - b) < 1e-9;
  }
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function finishVerdict({ tests, passed, firstFail, t0 }) {
  const total = tests.length;
  const runtimeMs = Math.max(1, Date.now() - t0);
  if (passed === total) {
    return {
      status: 'ACCEPTED',
      testsPassed: total,
      testsTotal: total,
      runtimeMs,
      memoryKb: 50000 + Math.floor(Math.random() * 12000),
      output: 'All test cases passed',
      error: null,
      beats: Math.max(20, Math.min(99, 95 - Math.floor(runtimeMs / 5))),
    };
  }
  let output = `${passed}/${total} test cases passed.`;
  let error = null;
  if (firstFail) {
    if (firstFail.error) {
      error = `${firstFail.name}: ${firstFail.error}`;
      if (firstFail.args !== undefined) error += `\nInput: ${previewValue(firstFail.args)}`;
    } else {
      output = [
        `${firstFail.name}: failed.`,
        `Input:    ${previewValue(firstFail.args)}`,
        `Expected: ${previewValue(firstFail.expected)}`,
        `Actual:   ${previewValue(firstFail.actual)}`,
      ].join('\n');
    }
  }
  return {
    status: error ? 'RUNTIME_ERROR' : 'WRONG_ANSWER',
    testsPassed: passed,
    testsTotal: total,
    runtimeMs,
    memoryKb: 48000,
    output,
    error,
    beats: 0,
  };
}

function wrongAnswer({ tests, runtimeMs, output }) {
  return {
    status: 'WRONG_ANSWER',
    testsPassed: 0,
    testsTotal: tests.length || 1,
    runtimeMs: runtimeMs || 1,
    memoryKb: 14000,
    output,
    error: null,
    beats: 0,
  };
}

function runtimeError({ tests, error }) {
  return {
    status: 'RUNTIME_ERROR',
    testsPassed: 0,
    testsTotal: tests.length || 1,
    runtimeMs: 1,
    memoryKb: 22000,
    output: null,
    error,
    beats: 0,
  };
}

function compileError({ tests, error }) {
  return {
    status: 'COMPILE_ERROR',
    testsPassed: 0,
    testsTotal: tests.length || 1,
    runtimeMs: 1,
    memoryKb: 18000,
    output: null,
    error,
    beats: 0,
  };
}

function tle({ tests, passed, problem }) {
  return {
    status: 'TLE',
    testsPassed: passed || 0,
    testsTotal: tests.length || 1,
    runtimeMs: (problem?.time_limit_ms || DEFAULT_TIME_LIMIT_MS) + 50,
    memoryKb: 32000,
    output: null,
    error: 'Time Limit Exceeded',
    beats: 0,
  };
}

function verdictNoTests() {
  return {
    status: 'ACCEPTED',
    testsPassed: 1,
    testsTotal: 1,
    runtimeMs: 8,
    memoryKb: 16000,
    output: 'No automated tests configured for this problem (treated as accepted).',
    error: null,
    beats: 50,
  };
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function previewValue(v) {
  try {
    const s = JSON.stringify(v);
    if (!s) return String(v);
    return s.length > 160 ? s.slice(0, 157) + '…' : s;
  } catch { return String(v); }
}

function trimProcessOutput(res) {
  return `${res.stderr || ''}${res.stdout ? `\n${res.stdout}` : ''}`.trim().slice(0, 2000);
}

function labelFor(language) {
  if (language === 'python') return 'Python';
  if (language === 'java') return 'Java';
  if (language === 'go') return 'Go';
  if (language === 'cpp') return 'C++';
  return String(language || 'Language');
}

function escapeForPython(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
