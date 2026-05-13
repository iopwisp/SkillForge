import { runJudge } from '../src/modules/judge/service.js';
import { hasExternalRuntime } from '../src/modules/judge/runtimes.js';

let passed = 0, failed = 0;
function ok(label, condition, details = '') {
  if (condition) {
    console.log(`  ok  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}${details ? ` :: ${details}` : ''}`);
    failed++;
  }
}

const addProblem = {
  problem_type: 'BACKEND',
  function_name: 'add',
  test_cases_json: JSON.stringify([
    { args: [2, 3], expected: 5 },
    { args: [-4, 10], expected: 6 },
  ]),
  time_limit_ms: 3000,
};

const publicUserProblem = {
  problem_type: 'BACKEND',
  function_name: 'publicUser',
  test_cases_json: JSON.stringify([
    {
      args: [{ id: 1, username: 'demo', email: 'hidden@example.com' }],
      expected: { id: 1, username: 'demo', fullName: null, avatarUrl: null },
    },
  ]),
  time_limit_ms: 3000,
};

const pythonAdd = `
def add(a, b):
    return a + b
`;

const pythonPublicUser = `
def publicUser(user):
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "fullName": user.get("fullName"),
        "avatarUrl": user.get("avatarUrl"),
    }
`;

const javaAdd = `
class Solution {
  public int add(int a, int b) {
    return a + b;
  }
}
`;

const javaPublicUser = `
import java.util.*;

class Solution {
  public Map<String, Object> publicUser(Map<String, Object> user) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", user.get("id"));
    out.put("username", user.get("username"));
    out.put("fullName", user.getOrDefault("fullName", null));
    out.put("avatarUrl", user.getOrDefault("avatarUrl", null));
    return out;
  }
}
`;

const goAdd = `
package main

func add(a int, b int) int {
  return a + b
}
`;

const goPublicUser = `
package main

func publicUser(user map[string]any) map[string]any {
  return map[string]any{
    "id": user["id"],
    "username": user["username"],
    "fullName": user["fullName"],
    "avatarUrl": user["avatarUrl"],
  }
}
`;

async function expectAccepted(language, problem, code) {
  const res = await runJudge(problem, code, language);
  ok(`${language} accepted`, res.status === 'ACCEPTED', JSON.stringify(res));
}

for (const [language, cases] of Object.entries({
  python: [[addProblem, pythonAdd], [publicUserProblem, pythonPublicUser]],
  java: [[addProblem, javaAdd], [publicUserProblem, javaPublicUser]],
  go: [[addProblem, goAdd], [publicUserProblem, goPublicUser]],
})) {
  if (!hasExternalRuntime(language)) {
    console.log(`  skip ${language} runtime not available`);
    continue;
  }
  for (const [problem, code] of cases) await expectAccepted(language, problem, code);
}

const unsupported = await runJudge(addProblem, 'int main() { return 0; }', 'rust');
ok('unsupported tested language returns COMPILE_ERROR', unsupported.status === 'COMPILE_ERROR', JSON.stringify(unsupported));

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
