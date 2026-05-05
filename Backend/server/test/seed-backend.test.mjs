/**
 * Run reference solutions for every seeded BACKEND/FRONTEND/SQL problem
 * through the real judge to make sure each problem is actually solvable
 * with the test cases as defined.
 */
import { runJsJudge, runSqlJudge } from '../src/judge.js';
import { BACKEND_PROBLEMS } from '../src/seeds/backend.js';

const REFERENCE_SOLUTIONS = {
  'parse-query-string': `
function parseQueryString(input) {
  if (!input) return {};
  let s = input;
  if (s[0] === '?') s = s.slice(1);
  if (!s) return {};
  const out = {};
  for (const part of s.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    let key, val;
    if (eq === -1) { key = part; val = ''; }
    else { key = part.slice(0, eq); val = part.slice(eq + 1); }
    key = decodeURIComponent(key.replace(/\\+/g, ' '));
    val = decodeURIComponent(val.replace(/\\+/g, ' '));
    if (out[key] === undefined) out[key] = val;
    else if (Array.isArray(out[key])) out[key].push(val);
    else out[key] = [out[key], val];
  }
  return out;
}`,
  'build-query-string': `
function buildQueryString(params) {
  const keys = Object.keys(params).sort();
  const parts = [];
  for (const k of keys) {
    const v = params[k];
    if (v === null || v === undefined) continue;
    const ek = encodeURIComponent(k);
    if (Array.isArray(v)) {
      for (const x of v) parts.push(ek + '=' + encodeURIComponent(String(x)));
    } else {
      parts.push(ek + '=' + encodeURIComponent(String(v)));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}`,
  'safe-json-parse': `
function safeParse(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}`,
  'paginate-list': `
function paginate(items, page, pageSize) {
  let p = Math.max(1, page);
  let s = pageSize <= 0 ? 100 : Math.min(100, pageSize);
  const total = items.length;
  const totalPages = Math.max(0, Math.ceil(total / s));
  const start = (p - 1) * s;
  return { items: items.slice(start, start + s), page: p, pageSize: s, total, totalPages };
}`,
  'merge-headers': `
function mergeHeaders(pairs) {
  const out = {};
  for (const [name, value] of pairs) {
    const k = String(name).toLowerCase();
    if (k === 'set-cookie') {
      if (Array.isArray(out[k])) out[k].push(value);
      else out[k] = [value];
    } else {
      out[k] = value;
    }
  }
  return out;
}`,
  'mask-credit-card': `
function maskCard(num) {
  if (!num) return '';
  const digitCount = (num.match(/\\d/g) || []).length;
  if (digitCount < 4) return num.replace(/\\d/g, '*');
  let seen = 0;
  const arr = [...num];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (/\\d/.test(arr[i])) {
      if (seen < 4) seen++;
      else arr[i] = '*';
    }
  }
  return arr.join('');
}`,
  'slugify': `
function slugify(input) {
  return String(input)
    .normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}`,
  'rate-limit-counter': `
function countRecent(timestamps, now, windowMs) {
  const cutoff = now - windowMs;
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] > cutoff && timestamps[i] <= now) count++;
    else if (timestamps[i] <= cutoff) break;
  }
  return count;
}`,
  'diff-objects': `
function diffObjects(before, after) {
  const added = {}, removed = {}, changed = {};
  for (const k of Object.keys(after)) {
    if (!(k in before)) added[k] = after[k];
    else if (!Object.is(before[k], after[k])) changed[k] = [before[k], after[k]];
  }
  for (const k of Object.keys(before)) {
    if (!(k in after)) removed[k] = before[k];
  }
  return { added, removed, changed };
}`,
  'resolve-redirects': `
function resolveRedirect(redirects, start) {
  const seen = new Set();
  let cur = start;
  while (cur in redirects) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    cur = redirects[cur];
  }
  return cur;
}`,
};

let okCount = 0, failCount = 0;
const failures = [];

for (const p of BACKEND_PROBLEMS) {
  const sol = REFERENCE_SOLUTIONS[p.slug];
  if (!sol) {
    console.log(`  ?? ${p.slug} (no reference solution)`);
    failCount++;
    failures.push(p.slug + ' (no ref)');
    continue;
  }
  const res = runJsJudge({
    function_name: p.functionName,
    test_cases_json: JSON.stringify(p.testCases),
    time_limit_ms: 1500,
  }, sol);
  if (res.status === 'ACCEPTED') {
    console.log(`  ok  ${p.slug}: ${res.testsPassed}/${res.testsTotal}`);
    okCount++;
  } else {
    console.log(`  FAIL ${p.slug}: ${res.status} (${res.testsPassed}/${res.testsTotal})`);
    console.log('       ' + (res.output || res.error || '').replaceAll('\n', '\n       '));
    failCount++;
    failures.push(p.slug);
  }
}

console.log(`\n${okCount} accepted, ${failCount} failed.`);
if (failures.length) console.log('Failures:', failures.join(', '));
process.exit(failCount === 0 ? 0 : 1);
