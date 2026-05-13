/**
 * Validate frontend problems with reference solutions.
 */
import { runJsJudge } from '../src/modules/judge/service.js';
import { FRONTEND_PROBLEMS } from '../src/shared/seed/frontend.js';

const REF = {
  'format-bytes': `
function formatBytes(n) {
  if (n === 0) return '0 B';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(abs) / Math.log(1024)));
  const value = abs / Math.pow(1024, i);
  let s = value.toFixed(2).replace(/\\.?0+$/, '');
  return sign + s + ' ' + units[i];
}`,

  'format-relative-time': `
function timeAgo(date, now) {
  const diff = Math.floor((now - date) / 1000);
  const future = diff < 0;
  const a = Math.abs(diff);
  let unit, n;
  if (a < 60) return 'just now';
  if (a < 3600) { n = Math.floor(a/60); unit = 'm'; }
  else if (a < 86400) { n = Math.floor(a/3600); unit = 'h'; }
  else if (a < 86400 * 30) { n = Math.floor(a/86400); unit = 'd'; }
  else if (a < 86400 * 365) { n = Math.floor(a/(86400*30)); unit = 'mo'; }
  else { n = Math.floor(a/(86400*365)); unit = 'y'; }
  return future ? 'in ' + n + unit : n + unit + ' ago';
}`,

  'kebab-case': `
function toKebab(input) {
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}`,

  'chunk-array': `
function chunk(array, size) {
  if (size <= 0) return [];
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}`,

  'paginate-pager': `
function getPages(current, total) {
  if (total <= 7) return Array.from({length: total}, (_, i) => String(i + 1));
  const keep = new Set([1, total, current, current - 1, current + 1]);
  const pages = [...keep].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) {
      const gap = pages[i] - pages[i - 1];
      if (gap === 2) out.push(String(pages[i - 1] + 1));
      else if (gap > 2) out.push('...');
    }
    out.push(String(pages[i]));
  }
  return out;
}`,

  'highlight-search': `
function highlight(text, query) {
  if (!text) return [];
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at === -1) {
      out.push({ text: text.slice(i), match: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), match: false });
    out.push({ text: text.slice(at, at + query.length), match: true });
    i = at + query.length;
  }
  return out;
}`,

  'breadcrumbs': `
function breadcrumbs(path) {
  const home = { label: 'Home', href: '/' };
  const parts = (path || '').split('/').filter(Boolean);
  let href = '';
  const out = [home];
  for (const seg of parts) {
    href += '/' + seg;
    let label = decodeURIComponent(seg).replace(/-/g, ' ');
    label = label.charAt(0).toUpperCase() + label.slice(1);
    out.push({ label, href });
  }
  return out;
}`,

  'cart-total': `
function cartTotal(items) {
  let subtotal = 0, discount = 0;
  for (const it of items) {
    const line = it.price * it.qty;
    subtotal += line;
    if (it.discount) discount += line * (it.discount / 100);
  }
  const round = x => Math.round(x * 100) / 100;
  subtotal = round(subtotal);
  discount = round(discount);
  return { subtotal, discount, total: round(subtotal - discount) };
}`,

  'flatten-tree': `
function flattenTree(nodes) {
  const out = [];
  function walk(arr, depth) {
    for (const n of arr) {
      out.push({ id: n.id, name: n.name, depth });
      if (n.children && n.children.length) walk(n.children, depth + 1);
    }
  }
  walk(nodes || [], 0);
  return out;
}`,

  'filter-tree': `
function filterTree(nodes, query) {
  if (!query) return nodes;
  const q = query.toLowerCase();
  function helper(arr) {
    const out = [];
    for (const n of arr) {
      const kids = n.children ? helper(n.children) : [];
      const selfMatch = n.name.toLowerCase().includes(q);
      if (selfMatch || kids.length) {
        const copy = { id: n.id, name: n.name };
        if (n.children) {
          if (selfMatch && kids.length === 0) copy.children = n.children.slice();
          else if (kids.length) copy.children = kids;
        }
        out.push(copy);
      }
    }
    return out;
  }
  return helper(nodes);
}`,
  'class-names': `
function classNames(...values) {
  const out = [];
  function add(value) {
    if (!value) return;
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) add(item);
    } else if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (value[key]) out.push(key);
      }
    }
  }
  for (const value of values) add(value);
  return out.join(' ');
}`,

  'toggle-selection': `
function toggleSelection(selected, id, multi) {
  const has = selected.includes(id);
  if (!multi) return has ? [] : [id];
  return has ? selected.filter(x => x !== id) : [...selected, id];
}`,
};

let okCount = 0, failCount = 0;
const failures = [];
for (const p of FRONTEND_PROBLEMS) {
  const sol = REF[p.slug];
  if (!sol) { console.log(`  ?? ${p.slug} (no ref)`); failCount++; failures.push(p.slug); continue; }
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
    console.log('       ' + (res.output || res.error || '').replaceAll('\n','\n       '));
    failCount++;
    failures.push(p.slug);
  }
}
console.log(`\n${okCount} accepted, ${failCount} failed.`);
process.exit(failCount === 0 ? 0 : 1);
