/**
 * Smoke / load test for the async judge pipeline in BullMQ mode.
 *
 * Requires:
 *   - Postgres on $DATABASE_URL (default 127.0.0.1:55432)
 *   - Redis  on $REDIS_URL      (default redis://127.0.0.1:56379)
 *
 * Run manually:
 *   JUDGE_QUEUE=bullmq REDIS_URL=redis://127.0.0.1:56379 \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/skillforge_test \
 *   JWT_SECRET=ci LOG_LEVEL=error \
 *   node --experimental-vm-modules test/smoke-bullmq.test.mjs
 *
 * What it does:
 *   1. Boots the Express app with JUDGE_QUEUE=bullmq.
 *   2. Starts a BullMQ worker in-process (same Node process, separate
 *      concurrency pool) — mirrors production topology minus the extra
 *      process boundary.
 *   3. Registers a user and fires N_CONCURRENT submissions in parallel,
 *      each with a unique Idempotency-Key.
 *   4. All POST responses must be 202 with status=PENDING (the worker
 *      hasn't finalized them yet in most cases).
 *   5. Polls GET /api/submissions/:id for every submission until all
 *      reach a non-PENDING status or the timeout expires.
 *   6. Asserts every submission ends up ACCEPTED.
 *   7. Verifies no duplicate rows were created (Idempotency-Key is
 *      unique per submission) and that the user's rating was bumped
 *      exactly once (first-solve invariant).
 */
process.env.NODE_ENV = 'test';
process.env.JUDGE_QUEUE = 'bullmq';
process.env.REDIS_URL ||= 'redis://127.0.0.1:56379';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:55432/skillforge_test';
process.env.JWT_SECRET = 'smoke-bullmq-secret';
process.env.AUTH_PROVIDERS = 'local';
process.env.LOG_LEVEL ||= 'error';

const N_CONCURRENT = 200;
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 60_000;

const { randomUUID } = await import('node:crypto');
const request = (await import('supertest')).default;
const { db } = await import('../src/shared/db.js');
const { runMigrations } = await import('../src/shared/migrations.js');
const { createApp } = await import('../src/app.js');
const {
  getJudgeQueueMode,
} = await import('../src/modules/submissions/service.js');
const {
  startBullmqWorker, shutdownQueue, _setQueueModeForTesting,
} = await import('../src/shared/queue.js');

// NODE_ENV=test makes resolveMode() default to 'inline'. We explicitly
// flip to bullmq here — this is the whole point of this smoke test.
_setQueueModeForTesting('bullmq');

/* ─── tiny test harness ────────────────────────────────────────────────── */

let passed = 0; let failed = 0;
function expect(label, cond, hint = '') {
  if (cond) { console.log(`  ok  ${label}`); passed++; }
  else      { console.error(`  FAIL  ${label}${hint ? ` :: ${hint}` : ''}`); failed++; }
}

/* ─── setup ────────────────────────────────────────────────────────────── */

await runMigrations();
await db.exec(`
  TRUNCATE TABLE
    refresh_tokens, oauth_states, favorites,
    submissions, exam_attempts, exam_problems, exams,
    group_members, groups, course_problems, courses,
    problems, categories, audit_events, users
  RESTART IDENTITY CASCADE
`);

expect('queue mode is bullmq', getJudgeQueueMode() === 'bullmq');

// Boot the worker in-process with concurrency=4.
const worker = await startBullmqWorker({ concurrency: 4 });
expect('bullmq worker started', !!worker);

// Insert a simple problem.
const TWO_SUM_TESTS = [
  { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
  { args: [[3, 2, 4],       6], expected: [1, 2] },
  { args: [[1, 2, 3],       4], expected: [0, 2] },
];

await db.none(`INSERT INTO categories (id, slug, name, description, color)
               VALUES (1, 'algos', 'Algorithms', 'Algorithm problems', 'indigo')`);

await db.none(`
  INSERT INTO problems
    (slug, title, description, difficulty, category_id, problem_type,
     starter_code_json, test_cases_json, function_name,
     time_limit_ms, memory_limit_mb)
  VALUES
    ('two-sum-smoke', 'Two Sum Smoke', 'Find indices.', 'EASY', 1, 'BACKEND',
     '{"javascript":"function twoSum(nums, t){}"}', $1, 'twoSum', 1000, 256)
`, [JSON.stringify(TWO_SUM_TESTS)]);

const app = createApp();
const api = request(app);

// Register a user.
const reg = await api.post('/api/auth/register').send({
  username: 'smokeuser', email: 'smoke@test.io', password: 'changeme123',
});
expect('register smokeuser -> 201', reg.status === 201, `status=${reg.status}`);
const token = reg.body.accessToken;
const userId = reg.body.user.id;
const auth = (req) => req.set('Authorization', `Bearer ${token}`);

/* ─── 1. Fire N_CONCURRENT submissions concurrently ──────────────────── */

const GOOD_CODE = `
function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}`;

console.log(`\nFiring ${N_CONCURRENT} concurrent submissions…`);
const t0 = Date.now();

const keys = [];
const promises = [];
for (let i = 0; i < N_CONCURRENT; i++) {
  const key = `smoke-${randomUUID()}`;
  keys.push(key);
  promises.push(
    auth(api.post('/api/submissions/two-sum-smoke'))
      .set('Idempotency-Key', key)
      .send({ code: GOOD_CODE, language: 'javascript' })
  );
}

const responses = await Promise.all(promises);
const submitMs = Date.now() - t0;
console.log(`  all ${N_CONCURRENT} POST responses received in ${submitMs} ms`);

const statusCounts = {};
const submissionIds = [];
for (const res of responses) {
  statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
  if (res.body?.id) submissionIds.push(res.body.id);
}
console.log(`  HTTP status distribution: ${JSON.stringify(statusCounts)}`);

// In bullmq mode, most should be 202 (some may already be finalized in
// inline fallback, but we explicitly set JUDGE_QUEUE=bullmq).
const all202 = responses.every(r => r.status === 202);
expect(`all ${N_CONCURRENT} POST responses -> 202`, all202,
  JSON.stringify(statusCounts));

const uniqueIds = new Set(submissionIds);
expect(`${N_CONCURRENT} unique submission ids created`,
  uniqueIds.size === N_CONCURRENT,
  `got ${uniqueIds.size} unique ids`);

/* ─── 2. Poll until all submissions leave PENDING ────────────────────── */

console.log(`\nPolling ${submissionIds.length} submissions until finalized…`);
const pending = new Set(submissionIds);
const verdicts = {};
const pollStart = Date.now();
let pollRounds = 0;

while (pending.size > 0 && (Date.now() - pollStart) < POLL_TIMEOUT_MS) {
  pollRounds++;
  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

  // Poll a batch at a time (all remaining pending).
  const batch = [...pending];
  const pollResults = await Promise.all(
    batch.map(id => auth(api.get(`/api/submissions/${id}`)).then(r => r.body))
  );
  for (let i = 0; i < batch.length; i++) {
    const sub = pollResults[i];
    if (sub.status !== 'PENDING') {
      pending.delete(batch[i]);
      verdicts[batch[i]] = sub.status;
    }
  }
}

const pollMs = Date.now() - pollStart;
const allFinalized = pending.size === 0;
console.log(`  finalized in ${pollMs} ms across ${pollRounds} poll rounds`);
expect(`all ${N_CONCURRENT} submissions finalized within timeout`,
  allFinalized, `still pending: ${pending.size}`);

/* ─── 3. Every verdict should be ACCEPTED ────────────────────────────── */

const verdictCounts = {};
for (const v of Object.values(verdicts)) {
  verdictCounts[v] = (verdictCounts[v] || 0) + 1;
}
console.log(`  verdict distribution: ${JSON.stringify(verdictCounts)}`);

const allAccepted = Object.values(verdicts).every(v => v === 'ACCEPTED');
expect(`all ${N_CONCURRENT} submissions -> ACCEPTED`, allAccepted,
  JSON.stringify(verdictCounts));

/* ─── 4. No duplicate submissions ────────────────────────────────────── */

const rowCount = await db.value(
  `SELECT COUNT(*)::int AS n FROM submissions`, [], 'n',
);
// We created N_CONCURRENT + the ones from earlier setup checks (0).
// The smoke test is isolated (TRUNCATE), so row count should be exactly N.
expect(`exactly ${N_CONCURRENT} submission rows in DB`,
  rowCount === N_CONCURRENT,
  `got ${rowCount}`);

/* ─── 5. Rating was bumped exactly once (first-solve invariant) ──────── */

const finalRating = await db.value(
  `SELECT rating FROM users WHERE id = $1`, [userId], 'rating',
);
// EASY problem -> +5 rating. Starting from 1200 (default).
expect('rating bumped exactly once for first solve -> 1205',
  finalRating === 1205,
  `got ${finalRating}`);

/* ─── 6. Summary ─────────────────────────────────────────────────────── */

console.log(`
─── Smoke Test Summary ───
  Concurrent submits: ${N_CONCURRENT}
  Submit wall time:   ${submitMs} ms
  Poll wall time:     ${pollMs} ms
  Poll rounds:        ${pollRounds}
  Verdicts:           ${JSON.stringify(verdictCounts)}
  DB rows:            ${rowCount}
  Final rating:       ${finalRating}
──────────────────────────`);

/* ─── cleanup ──────────────────────────────────────────────────────────── */

try { await worker.close(); } catch (err) { void err; }
try { await shutdownQueue(); } catch (err) { void err; }
await db.close();

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
