/**
 * Auth providers — unit-ish tests for the local/Google plugin abstraction
 * (ADR 0005). Covers:
 *
 *   - register: happy path, duplicate username, duplicate email
 *   - login: happy path, wrong password, nonexistent user, generic error message
 *   - refresh: happy path, double-use rotation
 *   - registry: getProvider, getProviderOrThrow, listProviders
 *   - google provider: enabled() reflects env, buildAuthUrl throws when disabled
 *
 * Tests run against a real Postgres database. The suite applies migrations,
 * truncates the relevant tables, and closes the shared pool on exit so it
 * doesn't pollute the developer database or keep Node alive.
 */
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'test-jwt-secret-not-used-anywhere-in-prod';
process.env.AUTH_PROVIDERS = 'local,google,microsoft';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.MICROSOFT_CLIENT_ID;
delete process.env.MICROSOFT_CLIENT_SECRET;
delete process.env.MICROSOFT_TENANT_ID;

const { db } = await import('../src/shared/db.js');
const { runMigrations } = await import('../src/shared/migrations.js');
const auth = await import('../src/modules/auth/service.js');
const { localProvider } = await import('../src/modules/auth/providers/local.js');
const { googleProvider } = await import('../src/modules/auth/providers/google.js');
const { microsoftProvider } = await import('../src/modules/auth/providers/microsoft.js');
const providers = await import('../src/modules/auth/providers/index.js');

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

async function tryCatch(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/* ─── 1. register: happy path ───────────────────────────────────────────── */

const r1 = await auth.register({
  username: 'alice',
  email: 'alice@test.io',
  password: 'changeme123',
  fullName: 'Alice Test',
});
expect('register returns access + refresh tokens',
  typeof r1.accessToken === 'string'
   && typeof r1.refreshToken === 'string'
   && r1.tokenType === 'Bearer'
   && typeof r1.expiresIn === 'number');
expect('register returns public user (no password_hash)',
  r1.user && r1.user.username === 'alice'
   && r1.user.email === 'alice@test.io'
   && r1.user.fullName === 'Alice Test'
   && r1.user.password_hash === undefined);

/* ─── 2. register: duplicate username/email rejected ────────────────────── */

const dupUser = await tryCatch(() => auth.register({
  username: 'alice', email: 'other@test.io', password: 'changeme123',
}));
expect('register with duplicate username rejected',
  dupUser && dupUser.status === 409 && /already taken/i.test(dupUser.message),
  `got ${dupUser?.message}`);

const dupEmail = await tryCatch(() => auth.register({
  username: 'alice2', email: 'alice@test.io', password: 'changeme123',
}));
expect('register with duplicate email rejected',
  dupEmail && dupEmail.status === 409,
  `got ${dupEmail?.message}`);

/* ─── 3. login: happy path + wrong password + unknown user ──────────────── */

const r3 = await auth.login({ emailOrUsername: 'alice', password: 'changeme123' });
expect('login by username succeeds',
  r3.user.id === r1.user.id);

const r3email = await auth.login({ emailOrUsername: 'alice@test.io', password: 'changeme123' });
expect('login by email succeeds',
  r3email.user.id === r1.user.id);

const wrongPw = await tryCatch(() => auth.login({ emailOrUsername: 'alice', password: 'WRONG' }));
expect('login with wrong password returns 401',
  wrongPw && wrongPw.status === 401,
  `got ${wrongPw?.status}`);

const noUser = await tryCatch(() => auth.login({ emailOrUsername: 'ghost', password: 'whatever' }));
expect('login with unknown user returns 401',
  noUser && noUser.status === 401,
  `got ${noUser?.status}`);

expect('wrong-password and unknown-user yield identical message (no enumeration)',
  wrongPw && noUser && wrongPw.message === noUser.message);

/* ─── 4. refresh: rotation + double-use rejection ───────────────────────── */

const r4 = await auth.refresh(r1.refreshToken);
expect('refresh issues new access + refresh tokens',
  typeof r4.accessToken === 'string'
   && typeof r4.refreshToken === 'string'
   && r4.refreshToken !== r1.refreshToken);

const reused = await tryCatch(() => auth.refresh(r1.refreshToken));
expect('refresh with already-rotated token returns 401',
  reused && reused.status === 401,
  `got ${reused?.status}`);

/* ─── 5. registry ───────────────────────────────────────────────────────── */

expect('getProvider("local") returns the local provider',
  providers.getProvider('local') === localProvider);

expect('getProvider("google") returns the google provider',
  providers.getProvider('google') === googleProvider);

expect('getProvider("nonexistent") returns null',
  providers.getProvider('nonexistent') === null);

const throwForUnknown = await tryCatch(() => providers.getProviderOrThrow('saml'));
expect('getProviderOrThrow("saml") throws HttpError(400)',
  throwForUnknown && throwForUnknown.status === 400);

/* ─── 6. listProviders + google enabled() reflects env ──────────────────── */

const list = providers.listProviders();
expect('listProviders includes local with type=password and enabled=true',
  list.some((p) => p.name === 'local' && p.type === 'password' && p.enabled));
expect('listProviders includes google with type=oauth2 and enabled=false (no creds)',
  list.some((p) => p.name === 'google' && p.type === 'oauth2' && p.enabled === false));

const googleAuthDisabled = await tryCatch(() => auth.buildOAuthAuthUrl('google'));
expect('buildOAuthAuthUrl("google") throws 503 when GOOGLE_CLIENT_ID not set',
  googleAuthDisabled && googleAuthDisabled.status === 503,
  `got ${googleAuthDisabled?.status}`);

// Now flip on env and re-check (without re-import — provider re-checks env on each call).
process.env.GOOGLE_CLIENT_ID = 'fake-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';

expect('googleProvider.enabled() reflects updated env',
  googleProvider.enabled() === true);

const url = await auth.buildOAuthAuthUrl('google', { next: '/dashboard' });
expect('buildOAuthAuthUrl("google") returns Google consent URL with state',
  typeof url === 'string'
   && url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')
   && /[?&]client_id=fake-client-id\b/.test(url)
   && /[?&]state=[a-f0-9]{32}\b/.test(url),
  url);

/* ─── 7. capabilities flags ─────────────────────────────────────────────── */

const list2 = providers.listProviders();
const localEntry = list2.find((p) => p.name === 'local');
const googleEntry = list2.find((p) => p.name === 'google');
expect('local advertises supportsRegister + supportsAuthenticate',
  localEntry.supportsRegister && localEntry.supportsAuthenticate);
expect('google advertises supportsOAuthRedirect',
  googleEntry.supportsOAuthRedirect);
expect('google does not claim supportsRegister/Authenticate',
  !googleEntry.supportsRegister && !googleEntry.supportsAuthenticate);

/* ─── 8. Microsoft provider: shape + capabilities ──────────────────────── */

expect('microsoftProvider.name === "microsoft"',
  microsoftProvider.name === 'microsoft');
expect('microsoftProvider.type === "oauth2"',
  microsoftProvider.type === 'oauth2');
expect('microsoftProvider.supportsOAuthRedirect === true',
  microsoftProvider.supportsOAuthRedirect === true);
expect('microsoftProvider.supportsRegister === false',
  microsoftProvider.supportsRegister === false);
expect('microsoftProvider.supportsAuthenticate === false',
  microsoftProvider.supportsAuthenticate === false);

/* ─── 9. Microsoft enabled() without env vars ──────────────────────────── */

expect('microsoftProvider.enabled() returns false without env vars',
  microsoftProvider.enabled() === false);

/* ─── 10. Microsoft enabled() with env vars ────────────────────────────── */

process.env.MICROSOFT_CLIENT_ID = 'test-ms-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-client-secret';
expect('microsoftProvider.enabled() returns true with both env vars set',
  microsoftProvider.enabled() === true);
delete process.env.MICROSOFT_CLIENT_ID;
delete process.env.MICROSOFT_CLIENT_SECRET;

/* ─── 11. Microsoft buildAuthUrl() when disabled ───────────────────────── */

const msBuildDisabled = await tryCatch(() => microsoftProvider.buildAuthUrl({ next: '/dashboard' }));
expect('buildAuthUrl() throws 503 when Microsoft not configured',
  msBuildDisabled && msBuildDisabled.status === 503,
  `got ${msBuildDisabled?.status}`);

/* ─── 12. Microsoft buildAuthUrl() when enabled ────────────────────────── */

process.env.MICROSOFT_CLIENT_ID = 'test-ms-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-client-secret';
process.env.MICROSOFT_TENANT_ID = 'test-tenant-123';

const msUrl = await microsoftProvider.buildAuthUrl({ next: '/dashboard' });
expect('buildAuthUrl() URL starts with correct Azure AD endpoint',
  msUrl.startsWith('https://login.microsoftonline.com/test-tenant-123/oauth2/v2.0/authorize'));
expect('buildAuthUrl() URL contains client_id matching env var',
  msUrl.includes('client_id=test-ms-client-id'));
expect('buildAuthUrl() URL contains response_type=code',
  msUrl.includes('response_type=code'));
expect('buildAuthUrl() URL contains scope with openid',
  /scope=[^&]*openid/.test(msUrl));
expect('buildAuthUrl() URL contains non-empty state',
  /[?&]state=[a-f0-9]{32}\b/.test(msUrl));
expect('buildAuthUrl() URL contains non-empty nonce',
  /[?&]nonce=[a-f0-9]{32}\b/.test(msUrl));

delete process.env.MICROSOFT_CLIENT_ID;
delete process.env.MICROSOFT_CLIENT_SECRET;
delete process.env.MICROSOFT_TENANT_ID;

/* ─── 13. Microsoft registry integration ───────────────────────────────── */

const list3 = providers.listProviders();
const msEntry = list3.find((p) => p.name === 'microsoft');
expect('listProviders() includes microsoft entry',
  !!msEntry);
expect('microsoft entry has type=oauth2',
  msEntry && msEntry.type === 'oauth2');
expect('microsoft entry has supportsOAuthRedirect=true',
  msEntry && msEntry.supportsOAuthRedirect === true);

/* ─── cleanup ───────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);
