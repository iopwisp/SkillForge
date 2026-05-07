// Quick smoke test for the judge — not part of the production build.
import { runSqlJudge, runJsJudge } from '../src/judge.js';

let pass = 0, fail = 0;
function expect(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL ${name} ${extra}`);
    fail++;
  }
}

console.log('—— SQL judge ——');
{
  const setup = `
    CREATE TABLE users (id INTEGER, name TEXT, country TEXT);
    INSERT INTO users VALUES (1,'Alice','US'),(2,'Bob','GB'),(3,'Charlie','US'),(4,'Dora','FR');
  `;
  const problem = {
    sql_setup: setup,
    test_cases_json: JSON.stringify([
      { name: 'all rows', expected: [[1,'Alice','US'],[2,'Bob','GB'],[3,'Charlie','US'],[4,'Dora','FR']] }
    ]),
    time_limit_ms: 1000,
  };
  const r1 = runSqlJudge(problem, 'SELECT id, name, country FROM users');
  expect('correct full scan accepted', r1.status === 'ACCEPTED');

  const r2 = runSqlJudge(problem, 'SELECT id FROM users');
  expect('missing columns rejected', r2.status === 'WRONG_ANSWER');

  const r3 = runSqlJudge(problem, 'SELECT id, name, country FROM users WHERE id = 99');
  expect('empty result rejected', r3.status === 'WRONG_ANSWER');

  // unordered comparison
  const problem2 = {
    sql_setup: setup,
    test_cases_json: JSON.stringify([
      { expected: [['US',2],['FR',1],['GB',1]] }
    ]),
    time_limit_ms: 1000,
  };
  const r4 = runSqlJudge(problem2, 'SELECT country, COUNT(*) FROM users GROUP BY country');
  expect('group by accepted (unordered)', r4.status === 'ACCEPTED', JSON.stringify(r4));

  // ordered comparison should fail if rows are in wrong order
  const problem3 = {
    sql_setup: setup,
    test_cases_json: JSON.stringify([
      { ordered: true, expected: [['Dora'],['Charlie'],['Bob'],['Alice']] }
    ]),
    time_limit_ms: 1000,
  };
  const r5 = runSqlJudge(problem3, 'SELECT name FROM users ORDER BY name DESC');
  expect('ordered alpha-desc accepted', r5.status === 'ACCEPTED');
  const r6 = runSqlJudge(problem3, 'SELECT name FROM users ORDER BY name ASC');
  expect('wrong order fails when ordered=true', r6.status === 'WRONG_ANSWER');

  // SQL syntax error
  const r7 = runSqlJudge(problem, 'NOT REAL SQL');
  expect('syntax error => RUNTIME_ERROR', r7.status === 'RUNTIME_ERROR');
}

console.log('—— JS judge ——');
{
  const problem = {
    function_name: 'twoSum',
    test_cases_json: JSON.stringify([
      { args: [[2,7,11,15], 9], expected: [0,1] },
      { args: [[3,2,4], 6],     expected: [1,2] },
      { args: [[3,3], 6],       expected: [0,1] },
    ]),
    time_limit_ms: 1500,
  };
  const good = `
    function twoSum(nums, target) {
      const m = new Map();
      for (let i = 0; i < nums.length; i++) {
        const c = target - nums[i];
        if (m.has(c)) return [m.get(c), i];
        m.set(nums[i], i);
      }
    }
  `;
  const r1 = runJsJudge(problem, good);
  expect('twoSum correct accepted', r1.status === 'ACCEPTED', r1.output);

  const r2 = runJsJudge(problem, 'function twoSum() { return []; }');
  expect('wrong return rejected', r2.status === 'WRONG_ANSWER');

  const r3 = runJsJudge(problem, 'function twoSum() { while (true) {} }');
  expect('infinite loop => TLE', r3.status === 'TLE');

  const r4 = runJsJudge(problem, 'function notTwoSum() { return []; }');
  expect('missing function => COMPILE_ERROR', r4.status === 'COMPILE_ERROR');

  const r5 = runJsJudge(problem, 'function twoSum() { throw new Error("nope"); }');
  expect('throw inside fn => RUNTIME_ERROR', r5.status === 'RUNTIME_ERROR');

  // module.exports support
  const r6 = runJsJudge(problem, `
    function twoSum(nums, target) {
      const m = new Map();
      for (let i = 0; i < nums.length; i++) {
        const c = target - nums[i];
        if (m.has(c)) return [m.get(c), i];
        m.set(nums[i], i);
      }
    }
    module.exports = { twoSum };
  `);
  expect('module.exports.twoSum works', r6.status === 'ACCEPTED');
}

console.log('—— set / sortedArray equality ——');
{
  const problem = {
    function_name: 'unique',
    test_cases_json: JSON.stringify([
      { args: [[3,1,2,3,2,1]], expected: [1,2,3], equals: 'set' },
    ]),
    time_limit_ms: 1000,
  };
  const r1 = runJsJudge(problem, 'function unique(a) { return [...new Set(a)]; }');
  expect('set equals: order independent', r1.status === 'ACCEPTED', JSON.stringify(r1));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
