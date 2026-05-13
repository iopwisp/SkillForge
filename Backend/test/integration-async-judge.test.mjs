/**
 * Integration tests for the async submit pipeline (per ADR 0013).
 *
 * Inline mode is the default in tests, so the verdict in the response
 * body is already final. We focus on the *new* surface area:
 *
 *   - 202 Accepted instead of 201 Created (semantic shift).
 *   - `finishedAt` is populated on a finalized submission.
 *   - `Idempotency-Key` collapses a retry of the same logical click
 *     onto the original submission, *without* enqueueing a second
 *     judge job (no rating double-bump, no problem counter
 *     double-bump).
 *   - A different user using the same Idempotency-Key for a
 *     different submission gets 409.
 *   - GET /api/submissions/:id polling returns the same row to its
 *     owner, 404s for someone else, 401s for an anon, and does NOT
 *     leak the submission's source code.
 *   - Bad Idempotency-Key (too short / invalid chars) -> 400.
 *   - The judge queue mode at boot is `inline` under NODE_ENV=test.
 *
 * Tests run against the real `skillforge_test` Postgres just like
 * `integration-submissions.test.mjs`. We insert problems directly so
 * we don't drift on seed-catalog changes.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-async-judge-secret';
process.env.AUTH_PROVIDERS = 'local';

const request = (await import('supertest')).default;
const { db } = await import('../src/shared/db.js');
const { runMigrations } = await import('../src/shared/migrations.js');
const { createApp } = await import('../src/app.js');
const { getJudgeQueueMode } = await import('../src/modules/submissions/service.js');

await runMigrations();
await db.exec(`
  TRUNCATE TABLE
    refresh_tokens,
    oauth_states,
    favorites,
    submissions,
    problems,
    categories,
    users
  RESTART IDENTITY CASCADE
`);

/* ─── fixtures ─────────────────────────────────────────────────────────── */

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
    ('two-sum-async', 'Two Sum Async', 'Find indices.', 'EASY', 1, 'BACKEND',
     '{"javascript":"function twoSum(nums, t){}"}', $1, 'twoSum', 1000, 256)
`, [JSON.stringify(TWO_SUM_TESTS)]);

const TWO_SUM_GOOD = `
  function twoSum(nums, target) {
    const seen = new Map();
    for (let i = 0; i < nums.length; i++) {
      const need = target - nums[i];
      if (seen.has(need)) return [seen.get(need), i];
      seen.set(nums[i], i);
    }
    return [];
  }
`;

/* ─── tiny test harness ────────────────────────────────────────────────── */

let passed = 0; let failed = 0;
function expect(label, cond, hint = '') {
  if (cond) { console.log(`  ok  ${label}`); passed++; }
  else      { console.error(`  FAIL  ${label}${hint ? ` :: ${hint}` : ''}`); failed++; }
}

const app = createApp();
const api = request(app);

/* ─── 1. Boot sanity: inline mode is on under NODE_ENV=test ────────────── */

expect('queue mode under NODE_ENV=test is "inline"', getJudgeQueueMode() === 'inline');

/* ─── 2. Register two users ────────────────────────────────────────────── */

const reg1 = await api.post('/api/auth/register').send({
  username: 'asyncuser', email: 'async@test.io', password: 'changeme123',
});
expect('register asyncuser -> 201', reg1.status === 201, JSON.stringify(reg1.body));
const token1 = reg1.body.accessToken;
const userId1 = reg1.body.user.id;

const reg2 = await api.post('/api/auth/register').send({
  username: 'asyncuser2', email: 'async2@test.io', password: 'changeme123',
});
expect('register asyncuser2 -> 201', reg2.status === 201);
const token2 = reg2.body.accessToken;

const auth = (req, t = token1) => req.set('Authorization', `Bearer ${t}`);

/* ─── 3. Submit returns 202 Accepted with finishedAt populated ─────────── */

const subRes = await auth(api.post('/api/submissions/two-sum-async')).send({
  code: TWO_SUM_GOOD, language: 'javascript',
});
expect('POST /api/submissions/:slug -> 202', subRes.status === 202,
  `status=${subRes.status} body=${JSON.stringify(subRes.body)}`);
expect('inline mode → response carries final ACCEPTED', subRes.body?.status === 'ACCEPTED');
expect('finishedAt is populated on finalized submission',
  typeof subRes.body?.finishedAt === 'string' && subRes.body.finishedAt.length > 0);
const submissionId = subRes.body.id;

/* ─── 4. Idempotency-Key replays the same submission ─────────────────────
 * Network retry: same key, same user, same problem, same code → must
 * collapse onto the original row, must not bump rating or counters
 * a second time, must not insert a new row.
 */
const idemKey = 'idem-aaaaaaaaaaa1';

const idem1 = await auth(api.post('/api/submissions/two-sum-async'))
  .set('Idempotency-Key', idemKey)
  .send({ code: TWO_SUM_GOOD, language: 'javascript' });
expect('first idempotent submit -> 202', idem1.status === 202);
const idem1Id = idem1.body.id;
expect('first idempotent submit creates a NEW row',
  idem1Id !== submissionId, `same id ${idem1Id}`);

const ratingAfterFirstIdem = await db.value(
  `SELECT rating FROM users WHERE id = $1`, [userId1], 'rating',
);

const idem2 = await auth(api.post('/api/submissions/two-sum-async'))
  .set('Idempotency-Key', idemKey)
  .send({ code: TWO_SUM_GOOD, language: 'javascript' });
expect('second submit with same idempotency key -> 202', idem2.status === 202);
expect('idempotent retry returns the SAME submission id',
  idem2.body.id === idem1Id,
  `expected ${idem1Id}, got ${idem2.body.id}`);

const ratingAfterRetry = await db.value(
  `SELECT rating FROM users WHERE id = $1`, [userId1], 'rating',
);
expect('rating unchanged on idempotent retry',
  ratingAfterRetry === ratingAfterFirstIdem,
  `before=${ratingAfterFirstIdem} after=${ratingAfterRetry}`);

const submissionRowCount = await db.value(
  `SELECT COUNT(*)::int AS n FROM submissions WHERE idempotency_key = $1`,
  [idemKey], 'n',
);
expect('exactly one submission row exists for the idempotency key',
  submissionRowCount === 1, `got ${submissionRowCount}`);

/* ─── 5. Conflicting use of the same key by a different user -> 409 ──── */

const conflicted = await auth(api.post('/api/submissions/two-sum-async'), token2)
  .set('Idempotency-Key', idemKey)
  .send({ code: TWO_SUM_GOOD, language: 'javascript' });
expect('different user with same idempotency key -> 409',
  conflicted.status === 409, `status=${conflicted.status}`);

/* ─── 6. Bad Idempotency-Key shape -> 400 ──────────────────────────────── */

const badShort = await auth(api.post('/api/submissions/two-sum-async'))
  .set('Idempotency-Key', 'xx')
  .send({ code: TWO_SUM_GOOD, language: 'javascript' });
expect('idempotency key < 8 chars -> 400', badShort.status === 400);

const badChars = await auth(api.post('/api/submissions/two-sum-async'))
  .set('Idempotency-Key', 'has spaces and bad chars!')
  .send({ code: TWO_SUM_GOOD, language: 'javascript' });
expect('idempotency key with bad chars -> 400', badChars.status === 400);

/* ─── 7. GET /api/submissions/:id polling endpoint ────────────────────── */

const pollRes = await auth(api.get(`/api/submissions/${submissionId}`));
expect('owner can poll their own submission -> 200', pollRes.status === 200);
expect('polled submission status is ACCEPTED', pollRes.body?.status === 'ACCEPTED');
expect('polled submission omits the source code (not on payload)',
  pollRes.body?.code === undefined,
  `got code=${typeof pollRes.body?.code}`);

const pollNoAuth = await api.get(`/api/submissions/${submissionId}`);
expect('anon polling -> 401', pollNoAuth.status === 401);

const pollOther = await auth(api.get(`/api/submissions/${submissionId}`), token2);
expect('other user polling someone else\'s submission -> 404 (no leak)',
  pollOther.status === 404,
  `status=${pollOther.status}`);

const pollUnknown = await auth(api.get(`/api/submissions/9999999`));
expect('polling unknown id -> 404', pollUnknown.status === 404);

const pollBad = await auth(api.get(`/api/submissions/not-a-number`));
expect('polling bad id -> 400', pollBad.status === 400);

/* ─── done ─────────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed.`);

await db.close();

if (failed > 0) process.exit(1);
