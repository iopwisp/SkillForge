/**
 * Integration tests for /api/courses/:slug/groups/* — Phase 1 #4 (ADR 0008).
 *
 * Drives the full nested-router stack (routes mounted with mergeParams
 * under /api/courses/:courseSlug/groups → requireRole(INSTRUCTOR,ADMIN)
 * → groups.service.assertCanManageCourse → groups.queries → Postgres).
 *
 * Also verifies the STUDENT course-visibility narrowing introduced in
 * this commit: a student who gets enrolled in a group becomes able to
 * see the course, and losing that membership hides it again.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-groups-jwt';
process.env.AUTH_PROVIDERS = 'local';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const request = (await import('supertest')).default;
const { db } = await import('../src/shared/db.js');
const { runMigrations } = await import('../src/shared/migrations.js');
const { createApp } = await import('../src/app.js');

await runMigrations();
await db.exec(`
  TRUNCATE TABLE
    group_members, groups,
    course_problems, courses,
    refresh_tokens, oauth_states, favorites, submissions, problems, categories, users
  RESTART IDENTITY CASCADE
`);

const app = createApp();
const api = request(app);

let pass = 0;
let fail = 0;
function expect(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL ${name} ${extra}`);
    fail++;
  }
}
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/* ─── precondition: users + courses ─────────────────────────────────────── */

const adminReg = await api.post('/api/auth/register').send({
  username: 'theadmin', email: 'admin@u.test', password: 'changeme123',
});
expect('precondition: admin registered and is ADMIN',
  adminReg.status === 201 && adminReg.body.user.role === 'ADMIN');
const adminTok = adminReg.body.accessToken;

const instr1Reg = await api.post('/api/auth/register').send({
  username: 'instr1', email: 'instr1@u.test', password: 'changeme123',
});
const instr2Reg = await api.post('/api/auth/register').send({
  username: 'instr2', email: 'instr2@u.test', password: 'changeme123',
});
const studentReg = await api.post('/api/auth/register').send({
  username: 'student1', email: 'student1@u.test', password: 'changeme123',
});
const student2Reg = await api.post('/api/auth/register').send({
  username: 'student2', email: 'student2@u.test', password: 'changeme123',
});

for (const id of [instr1Reg.body.user.id, instr2Reg.body.user.id]) {
  const r = await api.put(`/api/users/${id}/role`)
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect(`precondition: promote user #${id} to INSTRUCTOR`,
    r.status === 200 && r.body.role === 'INSTRUCTOR');
}

// Grab fresh tokens post-promotion (not strictly needed — requireRole
// re-reads from DB — but keeps traces clean).
const instr1Tok = (await api.post('/api/auth/login').send({
  emailOrUsername: 'instr1', password: 'changeme123',
})).body.accessToken;
const instr2Tok = (await api.post('/api/auth/login').send({
  emailOrUsername: 'instr2', password: 'changeme123',
})).body.accessToken;
const studentTok = studentReg.body.accessToken;
const student2Tok = student2Reg.body.accessToken;

// Two courses, owned by different instructors, so we can check both
// owner-permission and the per-course scoping of group slugs.
const cs101Create = await api.post('/api/courses').set(bearer(instr1Tok)).send({
  slug: 'cs101', title: 'CS 101',
});
expect('precondition: instr1 creates cs101', cs101Create.status === 201);

const ds301Create = await api.post('/api/courses').set(bearer(instr2Tok)).send({
  slug: 'ds301', title: 'DS 301',
});
expect('precondition: instr2 creates ds301', ds301Create.status === 201);

/* ─── auth gating ───────────────────────────────────────────────────────── */

console.log('—— auth gating ——');
{
  const noAuth = await api.get('/api/courses/cs101/groups');
  expect('GET groups without token -> 401', noAuth.status === 401);

  const noAuthCreate = await api.post('/api/courses/cs101/groups').send({ slug: 'ab', title: 'A' });
  expect('POST groups without token -> 401', noAuthCreate.status === 401);

  const studentCreate = await api.post('/api/courses/cs101/groups')
    .set(bearer(studentTok)).send({ slug: 'sneaky', title: 'S' });
  expect('POST groups as STUDENT -> 403', studentCreate.status === 403);

  const unknownCourse = await api.get('/api/courses/nope/groups').set(bearer(adminTok));
  expect('GET groups on unknown course -> 404', unknownCourse.status === 404);

  const unknownCourseCreate = await api.post('/api/courses/nope/groups')
    .set(bearer(adminTok)).send({ slug: 'ab', title: 'A' });
  expect('POST groups on unknown course -> 404',
    unknownCourseCreate.status === 404, `got ${unknownCourseCreate.status}`);
}

/* ─── create groups ─────────────────────────────────────────────────────── */

console.log('—— create ——');
{
  const nonOwner = await api.post('/api/courses/cs101/groups')
    .set(bearer(instr2Tok)).send({ slug: 'section-a', title: 'Section A' });
  expect('POST /cs101/groups as non-owner INSTRUCTOR -> 403',
    nonOwner.status === 403, `got ${nonOwner.status}`);

  const ok = await api.post('/api/courses/cs101/groups')
    .set(bearer(instr1Tok)).send({ slug: 'section-a', title: 'Section A' });
  expect('POST /cs101/groups as owner -> 201',
    ok.status === 201 && ok.body.slug === 'section-a' && ok.body.memberCount === 0);

  const adminCreate = await api.post('/api/courses/cs101/groups')
    .set(bearer(adminTok)).send({ slug: 'section-b', title: 'Section B' });
  expect('POST /cs101/groups as ADMIN -> 201',
    adminCreate.status === 201 && adminCreate.body.slug === 'section-b');

  const dup = await api.post('/api/courses/cs101/groups')
    .set(bearer(instr1Tok)).send({ slug: 'section-a', title: 'Dup' });
  expect('POST duplicate slug in same course -> 409', dup.status === 409);

  // The same slug in a different course is totally fine — slug is
  // unique PER COURSE, not globally (ADR 0008).
  const sameSlugDifferentCourse = await api.post('/api/courses/ds301/groups')
    .set(bearer(instr2Tok)).send({ slug: 'section-a', title: 'DS Section A' });
  expect('POST same slug in DIFFERENT course -> 201',
    sameSlugDifferentCourse.status === 201,
    `got ${sameSlugDifferentCourse.status}`);

  const badSlug = await api.post('/api/courses/cs101/groups')
    .set(bearer(instr1Tok)).send({ slug: 'BAD SLUG', title: 'Y' });
  expect('POST with invalid slug -> 400', badSlug.status === 400);

  const noTitle = await api.post('/api/courses/cs101/groups')
    .set(bearer(instr1Tok)).send({ slug: 'no-title' });
  expect('POST missing title -> 400', noTitle.status === 400);
}

/* ─── list / detail (admin / owner path) ────────────────────────────────── */

console.log('—— list + detail ——');
{
  const list = await api.get('/api/courses/cs101/groups').set(bearer(adminTok));
  expect('ADMIN sees all groups of cs101 (2)',
    list.status === 200 && list.body.length === 2, `got ${list.body?.length}`);
  expect('list rows have memberCount=0 and summary shape',
    list.body.every((g) => g.slug && g.title && g.memberCount === 0));

  const detail = await api.get('/api/courses/cs101/groups/section-a').set(bearer(instr1Tok));
  expect('owner GET /:groupSlug -> 200 with members=[]',
    detail.status === 200 && detail.body.slug === 'section-a'
     && Array.isArray(detail.body.members) && detail.body.members.length === 0);

  const missing = await api.get('/api/courses/cs101/groups/ghost').set(bearer(adminTok));
  expect('GET unknown group -> 404', missing.status === 404);
}

/* ─── update / delete ───────────────────────────────────────────────────── */

console.log('—— update / delete ——');
{
  const nonOwnerPut = await api.put('/api/courses/cs101/groups/section-a')
    .set(bearer(instr2Tok)).send({ title: 'Hijack' });
  expect('PUT group as non-owner INSTRUCTOR -> 403', nonOwnerPut.status === 403);

  const ownerPut = await api.put('/api/courses/cs101/groups/section-a')
    .set(bearer(instr1Tok)).send({ title: 'Section A — Spring' });
  expect('PUT group as owner -> 200 with updated title',
    ownerPut.status === 200 && ownerPut.body.title === 'Section A — Spring');

  const emptyPut = await api.put('/api/courses/cs101/groups/section-a')
    .set(bearer(instr1Tok)).send({});
  expect('PUT with empty body -> 400', emptyPut.status === 400);

  const adminOverride = await api.put('/api/courses/cs101/groups/section-a')
    .set(bearer(adminTok)).send({ title: 'Section A (admin override)' });
  expect('PUT group as ADMIN (not owner) -> 200', adminOverride.status === 200);

  const deleteOther = await api.delete('/api/courses/cs101/groups/section-b')
    .set(bearer(instr2Tok));
  expect('DELETE group as non-owner -> 403', deleteOther.status === 403);

  const deleteOk = await api.delete('/api/courses/cs101/groups/section-b')
    .set(bearer(instr1Tok));
  expect('DELETE group as owner -> 200',
    deleteOk.status === 200 && deleteOk.body.ok === true);

  const gone = await api.get('/api/courses/cs101/groups/section-b').set(bearer(adminTok));
  expect('after delete, GET that group -> 404', gone.status === 404);

  const listAfterDelete = await api.get('/api/courses/cs101/groups').set(bearer(adminTok));
  expect('list now has only 1 group in cs101', listAfterDelete.body.length === 1);
}

/* ─── add / remove members ──────────────────────────────────────────────── */

console.log('—— members ——');
{
  const byNonOwner = await api.post('/api/courses/cs101/groups/section-a/members')
    .set(bearer(instr2Tok)).send({ username: 'student1' });
  expect('POST member as non-owner -> 403', byNonOwner.status === 403);

  const add1 = await api.post('/api/courses/cs101/groups/section-a/members')
    .set(bearer(instr1Tok)).send({ username: 'student1' });
  expect('POST add student1 as owner -> 201',
    add1.status === 201 && add1.body.user.username === 'student1');

  const add2 = await api.post('/api/courses/cs101/groups/section-a/members')
    .set(bearer(adminTok)).send({ username: 'student2' });
  expect('POST add student2 as ADMIN -> 201',
    add2.status === 201 && add2.body.user.username === 'student2');

  const dup = await api.post('/api/courses/cs101/groups/section-a/members')
    .set(bearer(instr1Tok)).send({ username: 'student1' });
  expect('POST add same student twice -> 409', dup.status === 409);

  const badUser = await api.post('/api/courses/cs101/groups/section-a/members')
    .set(bearer(instr1Tok)).send({ username: 'nonexistent' });
  expect('POST add unknown username -> 404', badUser.status === 404);

  const missingBody = await api.post('/api/courses/cs101/groups/section-a/members')
    .set(bearer(instr1Tok)).send({});
  expect('POST add with missing body -> 400', missingBody.status === 400);

  const members = await api.get('/api/courses/cs101/groups/section-a/members')
    .set(bearer(instr1Tok));
  expect('GET members as owner shows both enrolled users',
    members.status === 200 && members.body.length === 2
     && members.body.map((m) => m.username).sort().join(',') === 'student1,student2',
    JSON.stringify(members.body.map((m) => m.username)));

  const listView = await api.get('/api/courses/cs101/groups').set(bearer(adminTok));
  expect('list view reflects memberCount=2 for section-a',
    listView.body.find((g) => g.slug === 'section-a')?.memberCount === 2);

  // Remove student2.
  const removeNonOwner = await api.delete('/api/courses/cs101/groups/section-a/members/student2')
    .set(bearer(instr2Tok));
  expect('DELETE member as non-owner -> 403', removeNonOwner.status === 403);

  const removeOk = await api.delete('/api/courses/cs101/groups/section-a/members/student2')
    .set(bearer(instr1Tok));
  expect('DELETE member as owner -> 200',
    removeOk.status === 200 && removeOk.body.ok === true);

  const removeAgain = await api.delete('/api/courses/cs101/groups/section-a/members/student2')
    .set(bearer(instr1Tok));
  expect('DELETE member again -> 404', removeAgain.status === 404);

  const removeUnknownUser = await api.delete('/api/courses/cs101/groups/section-a/members/nobody')
    .set(bearer(instr1Tok));
  expect('DELETE unknown username -> 404', removeUnknownUser.status === 404);
}

/* ─── student visibility on group list / detail / members ───────────────── */

console.log('—— student-scoped reads ——');
{
  // student1 is in cs101/section-a. student2 is in nothing (we removed
  // them above). Confirm student1 sees their own group, student2 sees
  // nothing in cs101, and neither sees ds301.
  const s1Groups = await api.get('/api/courses/cs101/groups').set(bearer(studentTok));
  expect('student1 sees exactly section-a in cs101',
    s1Groups.status === 200 && s1Groups.body.length === 1
     && s1Groups.body[0].slug === 'section-a');

  const s1Detail = await api.get('/api/courses/cs101/groups/section-a').set(bearer(studentTok));
  expect('student1 can GET their own group with members list visible',
    s1Detail.status === 200 && Array.isArray(s1Detail.body.members));

  const s2Groups = await api.get('/api/courses/cs101/groups').set(bearer(student2Tok));
  expect('student2 sees an empty group list in cs101 (they were removed)',
    s2Groups.status === 200 && s2Groups.body.length === 0);

  const s2Detail = await api.get('/api/courses/cs101/groups/section-a').set(bearer(student2Tok));
  expect('student2 GET on that group -> 404 (not a member)',
    s2Detail.status === 404);

  const s1ForeignCourse = await api.get('/api/courses/ds301/groups').set(bearer(studentTok));
  expect('student1 sees no groups in a course they are not enrolled in',
    s1ForeignCourse.status === 200 && s1ForeignCourse.body.length === 0);
}

/* ─── STUDENT course visibility (ADR 0008 §Course-visibility) ───────────── */

console.log('—— course visibility ——');
{
  // Before enrolment we already removed student2; meanwhile student1
  // is in cs101 but not ds301.
  const list = await api.get('/api/courses').set(bearer(studentTok));
  expect('student1 GET /api/courses sees ONLY cs101',
    list.status === 200 && list.body.length === 1 && list.body[0].slug === 'cs101',
    JSON.stringify(list.body));

  const cs101Detail = await api.get('/api/courses/cs101').set(bearer(studentTok));
  expect('student1 GET /api/courses/cs101 -> 200',
    cs101Detail.status === 200 && cs101Detail.body.slug === 'cs101');

  const ds301Detail = await api.get('/api/courses/ds301').set(bearer(studentTok));
  expect('student1 GET /api/courses/ds301 -> 404 (not enrolled)',
    ds301Detail.status === 404);

  // Enrol student1 in ds301 via instr2 -> they should see it.
  await api.post('/api/courses/ds301/groups/section-a/members')
    .set(bearer(instr2Tok)).send({ username: 'student1' });
  const listAfterEnrol = await api.get('/api/courses').set(bearer(studentTok));
  expect('after enrol in ds301, student1 sees both courses',
    listAfterEnrol.body.length === 2);

  // Remove the enrolment: visibility narrows back.
  await api.delete('/api/courses/ds301/groups/section-a/members/student1')
    .set(bearer(instr2Tok));
  const listAfterRemove = await api.get('/api/courses').set(bearer(studentTok));
  expect('after removal from ds301, student1 sees only cs101 again',
    listAfterRemove.body.length === 1 && listAfterRemove.body[0].slug === 'cs101');
}

/* ─── cascade: deleting the course drops its groups ─────────────────────── */

console.log('—— cascade ——');
{
  // Sanity: cs101 has 1 group. Delete the course, then the group
  // and its members should be gone thanks to ON DELETE CASCADE.
  const before = await db.value(
    `SELECT COUNT(*)::int AS n FROM groups WHERE course_id = (SELECT id FROM courses WHERE slug='cs101')`,
    [], 'n',
  );
  expect('cs101 still has 1 group before deletion', before === 1);

  const del = await api.delete('/api/courses/cs101').set(bearer(instr1Tok));
  expect('owner deletes cs101 -> 200', del.status === 200);

  const orphans = await db.value(
    `SELECT COUNT(*)::int AS n FROM groups g LEFT JOIN courses c ON c.id = g.course_id WHERE c.id IS NULL`,
    [], 'n',
  );
  expect('no orphan groups after course delete (ON DELETE CASCADE)', orphans === 0);

  const orphanMembers = await db.value(
    `SELECT COUNT(*)::int AS n FROM group_members gm LEFT JOIN groups g ON g.id = gm.group_id WHERE g.id IS NULL`,
    [], 'n',
  );
  expect('no orphan group_members after course delete', orphanMembers === 0);
}

/* ─── cleanup ───────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);
