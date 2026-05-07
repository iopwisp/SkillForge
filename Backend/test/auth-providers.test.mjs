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
 * Tests run against a temporary SQLite DB so they don't pollute the dev
 * file. Each invocation gets its own DB. Set DATABASE_FILE env BEFORE
 * dynamic-importing the auth modules so `shared/db.js` opens the temp file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(
  os.tmpdir(),
  `skillforge-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DATABASE_FILE = tmpDb;
process.env.JWT_SECRET = 'test-jwt-secret-not-used-anywhere-in-prod';
// Pin AUTH_PROVIDERS for deterministic registry behavior.
process.env.AUTH_PROVIDERS = 'local,google';
// Make sure Google is *disabled* (env-wise) at the start of the run; the
// google-enabled assertions toggle env vars later.
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const { db } = await import('../src/shared/db.js');
const auth = await import('../src/modules/auth/service.js');
const { localProvider } = await import('../src/modules/auth/providers/local.js');
const { googleProvider } = await import('../src/modules/auth/providers/google.js');
const providers = await import('../src/modules/auth/providers/index.js');

let pass = 0, fail = 0;
function expect(name, cond, extra = '') {
  if (cond) { console.log(`  ok  ${name}`); pass++; }
  else      { console.log(`  FAIL ${name} ${extra}`); fail++; }
}

function tryCatch(fn) {
  try { fn(); return null; }
  catch (e) { return e; }
}

/* ─── 1. register: happy path ───────────────────────────────────────────── */

const r1 = auth.register({
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

const dupUser = tryCatch(() => auth.register({
  username: 'alice', email: 'other@test.io', password: 'changeme123',
}));
expect('register with duplicate username rejected',
  dupUser && dupUser.status === 409 && /already taken/i.test(dupUser.message),
  `got ${dupUser?.message}`);

const dupEmail = tryCatch(() => auth.register({
  username: 'alice2', email: 'alice@test.io', password: 'changeme123',
}));
expect('register with duplicate email rejected',
  dupEmail && dupEmail.status === 409,
  `got ${dupEmail?.message}`);

/* ─── 3. login: happy path + wrong password + unknown user ──────────────── */

const r3 = auth.login({ emailOrUsername: 'alice', password: 'changeme123' });
expect('login by username succeeds',
  r3.user.id === r1.user.id);

const r3email = auth.login({ emailOrUsername: 'alice@test.io', password: 'changeme123' });
expect('login by email succeeds',
  r3email.user.id === r1.user.id);

const wrongPw = tryCatch(() => auth.login({ emailOrUsername: 'alice', password: 'WRONG' }));
expect('login with wrong password returns 401',
  wrongPw && wrongPw.status === 401,
  `got ${wrongPw?.status}`);

const noUser = tryCatch(() => auth.login({ emailOrUsername: 'ghost', password: 'whatever' }));
expect('login with unknown user returns 401',
  noUser && noUser.status === 401,
  `got ${noUser?.status}`);

expect('wrong-password and unknown-user yield identical message (no enumeration)',
  wrongPw && noUser && wrongPw.message === noUser.message);

/* ─── 4. refresh: rotation + double-use rejection ───────────────────────── */

const r4 = auth.refresh(r1.refreshToken);
expect('refresh issues new access + refresh tokens',
  typeof r4.accessToken === 'string'
   && typeof r4.refreshToken === 'string'
   && r4.refreshToken !== r1.refreshToken);

const reused = tryCatch(() => auth.refresh(r1.refreshToken));
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

const throwForUnknown = tryCatch(() => providers.getProviderOrThrow('saml'));
expect('getProviderOrThrow("saml") throws HttpError(400)',
  throwForUnknown && throwForUnknown.status === 400);

/* ─── 6. listProviders + google enabled() reflects env ──────────────────── */

const list = providers.listProviders();
expect('listProviders includes local with type=password and enabled=true',
  list.some((p) => p.name === 'local' && p.type === 'password' && p.enabled));
expect('listProviders includes google with type=oauth2 and enabled=false (no creds)',
  list.some((p) => p.name === 'google' && p.type === 'oauth2' && p.enabled === false));

const googleAuthDisabled = tryCatch(() => auth.buildOAuthAuthUrl('google'));
expect('buildOAuthAuthUrl("google") throws 503 when GOOGLE_CLIENT_ID not set',
  googleAuthDisabled && googleAuthDisabled.status === 503,
  `got ${googleAuthDisabled?.status}`);

// Now flip on env and re-check (without re-import — provider re-checks env on each call).
process.env.GOOGLE_CLIENT_ID = 'fake-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';

expect('googleProvider.enabled() reflects updated env',
  googleProvider.enabled() === true);

const url = auth.buildOAuthAuthUrl('google', { next: '/dashboard' });
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

/* ─── cleanup ───────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

try { db.close(); } catch { /* ignore */ }
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(tmpDb + suffix); } catch { /* ignore */ }
}

if (fail) process.exit(1);
