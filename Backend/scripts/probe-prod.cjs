/**
 * One-off probe of the production deploy.
 *
 * Tests:
 *   1. STDIO empty-code bug: submit no-op to a stdio problem; should NOT be ACCEPTED.
 *   2. Algorithm no-op submission: should also NOT be ACCEPTED.
 *   3. Microsoft SSO availability.
 */
const API = 'https://skillforge-47py.onrender.com';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let body;
  try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
  return { status: res.status, body };
}

async function pollUntilFinal(token, id, label) {
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await api(`/api/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.body?.status && r.body.status !== 'PENDING') {
      console.log(`[${label}] final after ${i + 1}s: status=${r.body.status} testsPassed=${r.body.testsPassed}/${r.body.testsTotal}`);
      console.log(`         output=${(r.body.output || '').slice(0, 200)}`);
      console.log(`         error=${r.body.error}`);
      return r.body.status;
    }
    process.stdout.write('.');
  }
  console.log(`\n[${label}] still PENDING after 60s`);
  return null;
}

(async () => {
  console.log('=== /api/auth/providers ===');
  const providers = await api('/api/auth/providers');
  console.log(providers.status, providers.body.map((p) => `${p.name}:${p.enabled}`).join(', '));

  console.log('\n=== /api/problems?pageSize=200 ===');
  const probs = await api('/api/problems?pageSize=200');
  const items = probs.body?.items || [];
  console.log('count', items.length);
  const stdioProbs = items.filter((p) => p.problemType === 'STDIO');
  const algos = items.filter((p) => p.problemType === 'ALGORITHM');
  const sql = items.filter((p) => p.problemType === 'SQL');
  const backend = items.filter((p) => p.problemType === 'BACKEND');
  const frontend = items.filter((p) => p.problemType === 'FRONTEND');
  console.log('stdio:', stdioProbs.length, stdioProbs.slice(0, 3).map((p) => p.slug).join(', '));
  console.log('algorithm:', algos.length, algos.slice(0, 3).map((p) => p.slug).join(', '));
  console.log('sql:', sql.length, sql.slice(0, 3).map((p) => p.slug).join(', '));
  console.log('backend:', backend.length, backend.slice(0, 3).map((p) => p.slug).join(', '));
  console.log('frontend:', frontend.length, frontend.slice(0, 3).map((p) => p.slug).join(', '));

  console.log('\n=== register a probe user ===');
  const u = `probe_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { username: u, email: `${u}@probe.local`, password: 'probe-password-123' },
  });
  console.log('register', reg.status, reg.body?.user?.username);
  if (!reg.body?.accessToken) { console.log('cannot register'); return; }
  const token = reg.body.accessToken;

  // === STDIO ===
  if (stdioProbs.length > 0) {
    const target = stdioProbs[0];
    console.log(`\n=== STDIO submit no-op to ${target.slug} ===`);
    const candidates = [
      { lang: 'PYTHON',     code: 'pass\n' },
      { lang: 'JAVASCRIPT', code: 'console.log("");\n' },
      { lang: 'JAVA',       code: 'public class Main { public static void main(String[] a){} }' },
      { lang: 'GO',         code: 'package main\nfunc main(){}\n' },
      { lang: 'CPP',        code: 'int main(){return 0;}\n' },
    ];
    let subId = null;
    let usedLang = null;
    for (const { lang, code } of candidates) {
      const submit = await api(`/api/submissions/${target.slug}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { code, language: lang },
      });
      console.log(`  try ${lang}: ${submit.status} ${JSON.stringify(submit.body).slice(0, 100)}`);
      if (submit.status === 202 && submit.body?.id) {
        subId = submit.body.id;
        usedLang = lang;
        break;
      }
    }
    if (subId) {
      console.log(`accepted by ${usedLang}, polling ${subId}...`);
      const verdict = await pollUntilFinal(token, subId, `stdio/${target.slug}`);
      console.log(verdict === 'ACCEPTED'
        ? `❌ STDIO BUG: no-op got ACCEPTED on ${target.slug}`
        : `✅ STDIO ${target.slug}: no-op got ${verdict}`);
    } else {
      console.log('STDIO: no language passed allowlist — skipping');
    }
  }

  // === ALGORITHM ===
  if (algos.length > 0) {
    const target = algos[0];
    console.log(`\n=== ALGORITHM submit no-op to ${target.slug} ===`);
    const submit = await api(`/api/submissions/${target.slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'function noop(){ return null; }', language: 'JAVASCRIPT' },
    });
    console.log('  status', submit.status, JSON.stringify(submit.body).slice(0, 200));
    if (submit.body?.id) {
      const verdict = await pollUntilFinal(token, submit.body.id, `algo/${target.slug}`);
      console.log(verdict === 'ACCEPTED'
        ? `❌ ALGORITHM BUG: no-op got ACCEPTED on ${target.slug}`
        : `✅ ALGORITHM ${target.slug}: no-op got ${verdict}`);
    }
  }

  // === SQL ===
  if (sql.length > 0) {
    const target = sql[0];
    console.log(`\n=== SQL submit empty SELECT to ${target.slug} ===`);
    const submit = await api(`/api/submissions/${target.slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'SELECT 1;', language: 'SQL' },
    });
    console.log('  status', submit.status, JSON.stringify(submit.body).slice(0, 200));
    if (submit.body?.id) {
      const verdict = await pollUntilFinal(token, submit.body.id, `sql/${target.slug}`);
      console.log(verdict === 'ACCEPTED'
        ? `❌ SQL BUG: trivial SELECT 1 got ACCEPTED on ${target.slug}`
        : `✅ SQL ${target.slug}: SELECT 1 got ${verdict}`);
    }
  }

  // === BACKEND ===
  if (backend.length > 0) {
    const target = backend[0];
    console.log(`\n=== BACKEND submit no-op to ${target.slug} ===`);
    const submit = await api(`/api/submissions/${target.slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'function solve(){ return null; }', language: 'JAVASCRIPT' },
    });
    console.log('  status', submit.status, JSON.stringify(submit.body).slice(0, 200));
    if (submit.body?.id) {
      const verdict = await pollUntilFinal(token, submit.body.id, `backend/${target.slug}`);
      console.log(verdict === 'ACCEPTED'
        ? `❌ BACKEND BUG: no-op got ACCEPTED on ${target.slug}`
        : `✅ BACKEND ${target.slug}: no-op got ${verdict}`);
    }
  }

  // === FRONTEND ===
  if (frontend.length > 0) {
    const target = frontend[0];
    console.log(`\n=== FRONTEND submit no-op to ${target.slug} ===`);
    const submit = await api(`/api/submissions/${target.slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'function solve(){ return null; }', language: 'JAVASCRIPT' },
    });
    console.log('  status', submit.status, JSON.stringify(submit.body).slice(0, 200));
    if (submit.body?.id) {
      const verdict = await pollUntilFinal(token, submit.body.id, `frontend/${target.slug}`);
      console.log(verdict === 'ACCEPTED'
        ? `❌ FRONTEND BUG: no-op got ACCEPTED on ${target.slug}`
        : `✅ FRONTEND ${target.slug}: no-op got ${verdict}`);
    }
  }
})().catch((e) => {
  console.error('error:', e.message, e.stack);
  process.exit(1);
});

