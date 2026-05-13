/**
 * Backend-flavoured JavaScript practice problems.
 *
 * Each problem provides a `function_name`, a `testCases` array
 * (`{args, expected}`), and starter code in JS/TS. The tests run in a
 * Node `vm` sandbox per src/judge.js.
 */

export const BACKEND_PROBLEMS = [
  {
    slug: 'parse-query-string',
    title: 'Parse Query String',
    difficulty: 'EASY',
    category: 'backend',
    tags: 'http,parsing,strings',
    description:
`Implement \`parseQueryString(input)\` that converts a URL query string into a plain object.

* Leading \`?\` is optional and must be ignored.
* If a key appears more than once, collect all values into an array (preserving order).
* Decode \`%xx\` escapes and treat \`+\` as a space (URL-encoded form).
* Empty input returns \`{}\`.

Do **not** rely on \`URLSearchParams\` — implement the parsing yourself.`,
    examples: [
      { input: '"?page=2&size=20"',                 output: '{ page: "2", size: "20" }' },
      { input: '"name=John+Doe&city=New%20York"',   output: '{ name: "John Doe", city: "New York" }' },
      { input: '"tag=a&tag=b&tag=c"',               output: '{ tag: ["a","b","c"] }' },
    ],
    constraints: '• Input length ≤ 2000 chars\n• ASCII keys only\n• Keys without `=` map to empty string',
    hints: [
      'Strip a leading "?" before splitting on "&".',
      'For each pair, split on the FIRST "=" only — values may contain "=" chars.',
      'decodeURIComponent + replace `+` → space gives the standard form decoding.',
    ],
    starterCode: {
      javascript:
`/**
 * @param {string} input
 * @returns {Object<string, string|string[]>}
 */
function parseQueryString(input) {
  // your code here
}
`,
      typescript:
`function parseQueryString(input: string): Record<string, string | string[]> {
  // your code here
  return {};
}
`,
    },
    functionName: 'parseQueryString',
    testCases: [
      { name: 'empty',       args: [''],                         expected: {} },
      { name: 'just ?',      args: ['?'],                        expected: {} },
      { name: 'simple',      args: ['?page=2&size=20'],          expected: { page: '2', size: '20' } },
      { name: 'plus space',  args: ['name=John+Doe'],            expected: { name: 'John Doe' } },
      { name: 'percent',     args: ['city=New%20York'],          expected: { city: 'New York' } },
      { name: 'repeated',    args: ['tag=a&tag=b&tag=c'],        expected: { tag: ['a', 'b', 'c'] } },
      { name: 'no value',    args: ['?flag&debug'],              expected: { flag: '', debug: '' } },
      { name: 'with =',      args: ['filter=id=42&page=1'],      expected: { filter: 'id=42', page: '1' } },
    ],
  },

  {
    slug: 'build-query-string',
    title: 'Build Query String',
    difficulty: 'EASY',
    category: 'backend',
    tags: 'http,strings,encoding',
    description:
`Implement \`buildQueryString(params)\` — the inverse of \`parseQueryString\`.

* Returned string starts with \`?\` (or empty when \`params\` is empty).
* Keys are sorted alphabetically (deterministic output for tests/cache keys).
* Array values produce repeated keys, in original order.
* \`null\` and \`undefined\` values are skipped entirely.
* Encode keys and values with \`encodeURIComponent\`.`,
    examples: [
      { input: '{ page: 2, size: 20 }',       output: '"?page=2&size=20"' },
      { input: '{ tag: ["a","b"], q: "hi" }', output: '"?q=hi&tag=a&tag=b"' },
      { input: '{}',                          output: '""' },
    ],
    constraints: '• At most 50 keys\n• Skip null/undefined; serialise everything else with String()',
    hints: ['Object.keys + sort alphabetically.', 'Use encodeURIComponent so spaces/&/= are encoded correctly.'],
    starterCode: {
      javascript:
`function buildQueryString(params) {
  // your code here
}
`,
      typescript:
`function buildQueryString(
  params: Record<string, string | number | boolean | null | undefined | (string | number)[]>,
): string {
  return '';
}
`,
    },
    functionName: 'buildQueryString',
    testCases: [
      { name: 'empty',          args: [{}],                                       expected: '' },
      { name: 'simple',         args: [{ page: 2, size: 20 }],                    expected: '?page=2&size=20' },
      { name: 'sorted',         args: [{ b: 1, a: 2, c: 3 }],                     expected: '?a=2&b=1&c=3' },
      { name: 'array',          args: [{ tag: ['x', 'y', 'z'], q: 'hi' }],        expected: '?q=hi&tag=x&tag=y&tag=z' },
      { name: 'skip null',      args: [{ page: 1, q: null, size: undefined }],    expected: '?page=1' },
      { name: 'encode special', args: [{ q: 'hello world&friends' }],             expected: '?q=hello%20world%26friends' },
    ],
  },

  {
    slug: 'safe-json-parse',
    title: 'Safe JSON Parse',
    difficulty: 'EASY',
    category: 'backend',
    tags: 'json,error handling',
    description:
`Backend code receives untrusted JSON over the wire. Implement
\`safeParse(text, fallback)\` that:

* returns the parsed value when \`text\` is valid JSON,
* returns \`fallback\` when \`text\` is invalid, \`null\`, \`undefined\`, or empty,
* never throws.

The fallback can be any value (object, array, primitive).`,
    examples: [
      { input: '"{\\"ok\\":true}", null',  output: '{ ok: true }' },
      { input: '"oops", { error: true }', output: '{ error: true }' },
      { input: 'null, []',                 output: '[]' },
    ],
    constraints: '• Don\'t use try/catch around third-party libraries — wrap JSON.parse only.',
    hints: ['Use try/catch around JSON.parse.', 'Treat null/undefined/"" as "no input".'],
    starterCode: {
      javascript:
`function safeParse(text, fallback) {
  // your code here
}
`,
      typescript:
`function safeParse<T>(text: string | null | undefined, fallback: T): T | unknown {
  return fallback;
}
`,
    },
    functionName: 'safeParse',
    testCases: [
      { name: 'valid object',   args: ['{"ok":true}', null],          expected: { ok: true } },
      { name: 'valid array',    args: ['[1,2,3]', null],              expected: [1, 2, 3] },
      { name: 'invalid string', args: ['oops', { error: true }],      expected: { error: true } },
      { name: 'null input',     args: [null, []],                     expected: [] },
      { name: 'undefined',      args: [undefined, 'fallback'],        expected: 'fallback' },
      { name: 'empty string',   args: ['', { e: 1 }],                 expected: { e: 1 } },
      { name: 'number',         args: ['42', null],                   expected: 42 },
    ],
  },

  {
    slug: 'paginate-list',
    title: 'Paginate a List',
    difficulty: 'EASY',
    category: 'backend',
    tags: 'pagination,api design',
    description:
`Implement a typical REST pagination helper:

\`\`\`
paginate(items, page, pageSize) → {
  items: <slice>,
  page,
  pageSize,
  total: items.length,
  totalPages: Math.ceil(total / pageSize),
}
\`\`\`

* \`page\` is **1-based**.
* \`page\` < 1 should be coerced to 1.
* \`page\` > totalPages returns an empty \`items\` slice (don't throw).
* \`pageSize\` ≤ 0 or > 100 should be clamped to 100.`,
    examples: [
      { input: '[1..10], page=2, size=3', output: '{ items: [4,5,6], page: 2, pageSize: 3, total: 10, totalPages: 4 }' },
      { input: '[1..5], page=99, size=10', output: '{ items: [], page: 99, pageSize: 10, total: 5, totalPages: 1 }' },
    ],
    constraints: '• 0 ≤ items.length ≤ 10000',
    hints: ['offset = (page - 1) * pageSize.', 'Clamp pageSize before computing totalPages.'],
    starterCode: {
      javascript:
`function paginate(items, page, pageSize) {
  // your code here
}
`,
      typescript:
`function paginate<T>(items: T[], page: number, pageSize: number): {
  items: T[]; page: number; pageSize: number; total: number; totalPages: number;
} {
  return { items: [], page: 1, pageSize: 1, total: 0, totalPages: 0 };
}
`,
    },
    functionName: 'paginate',
    testCases: [
      { args: [[1,2,3,4,5,6,7,8,9,10], 2, 3], expected: { items:[4,5,6], page:2, pageSize:3, total:10, totalPages:4 } },
      { args: [[1,2,3,4,5,6,7,8,9,10], 1, 5], expected: { items:[1,2,3,4,5], page:1, pageSize:5, total:10, totalPages:2 } },
      { args: [[1,2,3,4,5], 99, 10],          expected: { items:[], page:99, pageSize:10, total:5, totalPages:1 } },
      { args: [[], 1, 10],                    expected: { items:[], page:1, pageSize:10, total:0, totalPages:0 } },
      { args: [[1,2,3], -5, 1],               expected: { items:[1], page:1, pageSize:1, total:3, totalPages:3 } },
      { args: [[1,2,3], 1, 0],                expected: { items:[1,2,3], page:1, pageSize:100, total:3, totalPages:1 } },
    ],
  },

  {
    slug: 'merge-headers',
    title: 'Merge HTTP Headers',
    difficulty: 'EASY',
    category: 'backend',
    tags: 'http,maps,strings',
    description:
`HTTP header names are case-insensitive. Given an array of \`[name, value]\` pairs,
return a plain object whose keys are **lowercased** header names mapped to their value.

When the same header appears more than once, **the last one wins**, except for
\`set-cookie\` which collects an array of values (in original order).`,
    examples: [
      { input: '[["Content-Type","text/html"],["X-Foo","1"],["x-foo","2"]]', output: '{ "content-type":"text/html", "x-foo":"2" }' },
      { input: '[["Set-Cookie","a=1"],["Set-Cookie","b=2"]]',                output: '{ "set-cookie": ["a=1","b=2"] }' },
    ],
    constraints: '• 0 ≤ pairs.length ≤ 100',
    hints: ['Iterate once, lowercase the key, special-case set-cookie into an array.'],
    starterCode: {
      javascript:
`function mergeHeaders(pairs) {
  // your code here
}
`,
    },
    functionName: 'mergeHeaders',
    testCases: [
      { args: [[]], expected: {} },
      { args: [[['Content-Type','text/html']]], expected: { 'content-type': 'text/html' } },
      { args: [[['Content-Type','text/html'],['X-Foo','1'],['x-foo','2']]], expected: { 'content-type': 'text/html', 'x-foo': '2' } },
      { args: [[['Set-Cookie','a=1'],['Set-Cookie','b=2']]], expected: { 'set-cookie': ['a=1', 'b=2'] } },
      { args: [[['Set-Cookie','one'],['Content-Type','json'],['set-cookie','two']]], expected: { 'set-cookie': ['one','two'], 'content-type':'json' } },
    ],
  },

  {
    slug: 'mask-credit-card',
    title: 'Mask a Credit-Card Number',
    difficulty: 'EASY',
    category: 'backend',
    tags: 'pii,strings,validation',
    description:
`To safely log payment events, replace all but the **last 4 digits** of a credit-card
number with \`*\`. Preserve the original spaces / dashes that separate groups
of digits — only digits are masked.

If the input has fewer than 4 digits, mask **everything**.`,
    examples: [
      { input: '"4111 1111 1111 1234"',  output: '"**** **** **** 1234"' },
      { input: '"4111-1111-1111-1234"',  output: '"****-****-****-1234"' },
      { input: '"123"',                   output: '"***"' },
    ],
    constraints: '• Input length ≤ 50 chars\n• Input contains digits, spaces, and "-" only',
    hints: ['Walk the string from right to left, keep the last 4 digits intact.'],
    starterCode: {
      javascript: `function maskCard(num) {\n  // your code here\n}\n`,
    },
    functionName: 'maskCard',
    testCases: [
      { args: ['4111 1111 1111 1234'], expected: '**** **** **** 1234' },
      { args: ['4111-1111-1111-1234'], expected: '****-****-****-1234' },
      { args: ['4111111111111234'],    expected: '************1234' },
      { args: ['123'],                  expected: '***' },
      { args: [''],                     expected: '' },
    ],
  },

  {
    slug: 'slugify',
    title: 'URL-Friendly Slug',
    difficulty: 'MEDIUM',
    category: 'backend',
    tags: 'strings,routing',
    description:
`Convert a free-form title into a clean URL slug:

* Lowercase the entire string.
* Trim leading and trailing whitespace.
* Replace any run of non-alphanumeric characters with a single \`-\`.
* Collapse multiple consecutive \`-\` into one.
* Drop leading and trailing \`-\` from the final result.
* Strip diacritics so \`"Crème Brûlée"\` becomes \`"creme-brulee"\`.`,
    examples: [
      { input: '"Hello World!"',       output: '"hello-world"' },
      { input: '"  Foo --- Bar  "',    output: '"foo-bar"' },
      { input: '"Crème Brûlée v2.0"',  output: '"creme-brulee-v2-0"' },
    ],
    constraints: '• Input length ≤ 200 chars',
    hints: [
      'String.prototype.normalize("NFKD") + replace(/[\\u0300-\\u036f]/g, "") strips diacritics.',
      'Replace non-alphanumeric with "-" then collapse consecutive "-".',
    ],
    starterCode: {
      javascript: `function slugify(input) {\n  // your code here\n}\n`,
    },
    functionName: 'slugify',
    testCases: [
      { args: ['Hello World!'],        expected: 'hello-world' },
      { args: ['  Foo --- Bar  '],     expected: 'foo-bar' },
      { args: ['Crème Brûlée v2.0'],   expected: 'creme-brulee-v2-0' },
      { args: ['---'],                 expected: '' },
      { args: ['CamelCaseInput'],      expected: 'camelcaseinput' },
      { args: ['UPPER lower MiXeD 42'], expected: 'upper-lower-mixed-42' },
    ],
  },

  {
    slug: 'rate-limit-counter',
    title: 'Sliding-Window Rate Limiter',
    difficulty: 'MEDIUM',
    category: 'backend',
    tags: 'rate limiting,arrays',
    description:
`Given a chronologically sorted list of request timestamps (ms) and a window
\`windowMs\`, return how many requests fall inside a sliding window of length
\`windowMs\` ending at \`now\`. The window is the half-open interval
\`(now - windowMs, now]\` — requests at exactly \`now - windowMs\` are
**excluded**, requests at exactly \`now\` are **included**.

\`\`\`
countRecent(timestamps, now, windowMs)
\`\`\``,
    examples: [
      { input: 'timestamps=[1000,1500,1900,2500], now=2500, windowMs=1000', output: '2', explanation: 'window is (1500, 2500] — only 1900 and 2500 qualify.' },
    ],
    constraints: '• timestamps is sorted ascending\n• 0 ≤ timestamps.length ≤ 10⁵',
    hints: ['Two pointers / binary search — find the first index whose value > now-windowMs.'],
    starterCode: {
      javascript: `function countRecent(timestamps, now, windowMs) {\n  // your code here\n}\n`,
    },
    functionName: 'countRecent',
    testCases: [
      { args: [[1000,1500,1900,2500], 2500, 1000], expected: 2 },
      { args: [[1000,1500,1900,2500], 2500, 1500], expected: 3 },
      { args: [[1000,1500,1900,2500], 1900, 500],  expected: 2 },
      { args: [[1000,1500,1900,2500], 5000, 1000], expected: 0 },
      { args: [[], 100, 1000],                     expected: 0 },
      { args: [[1,2,3,4,5,6,7,8,9,10], 10, 5],     expected: 5 },
      { args: [[1,2,3,4,5,6,7,8,9,10], 7, 3],      expected: 3 },
    ],
  },

  {
    slug: 'diff-objects',
    title: 'Diff Two Objects',
    difficulty: 'MEDIUM',
    category: 'backend',
    tags: 'objects,audit log',
    description:
`Given two flat objects \`before\` and \`after\`, return an object listing only the
keys whose values differ.

\`\`\`
diffObjects(before, after) → {
  added:    { ...key→value },  // keys present only in after
  removed:  { ...key→value },  // keys present only in before
  changed:  { ...key→ [before, after] }
}
\`\`\`

* Use \`Object.is\` semantics for comparison (so \`NaN === NaN\`, \`+0 !== -0\`).
* Both inputs are guaranteed to be plain objects with primitive values.`,
    examples: [
      { input: '{a:1,b:2}, {a:1,b:3,c:4}', output: '{ added:{c:4}, removed:{}, changed:{b:[2,3]} }' },
    ],
    constraints: '• At most 100 keys per object',
    hints: ['Iterate over keys of both objects.', 'Object.is handles the NaN/-0 corner cases.'],
    starterCode: {
      javascript: `function diffObjects(before, after) {\n  // your code here\n}\n`,
    },
    functionName: 'diffObjects',
    testCases: [
      { args: [{a:1,b:2},{a:1,b:3,c:4}], expected: { added:{c:4}, removed:{}, changed:{b:[2,3]} } },
      { args: [{a:1},{a:1}],             expected: { added:{}, removed:{}, changed:{} } },
      { args: [{a:1,b:2},{a:1}],         expected: { added:{}, removed:{b:2}, changed:{} } },
      { args: [{},{x:'new'}],            expected: { added:{x:'new'}, removed:{}, changed:{} } },
      { args: [{a:1,b:'x'},{a:2,b:'x',c:'y'}], expected: { added:{c:'y'}, removed:{}, changed:{a:[1,2]} } },
    ],
  },

  {
    slug: 'resolve-redirects',
    title: 'Resolve Redirect Chain',
    difficulty: 'MEDIUM',
    category: 'backend',
    tags: 'graphs,http',
    description:
`Some web crawlers cache 301/302 redirects in a map. Given that map and a starting URL,
follow the chain until you hit a URL that isn't a key in the map, and return that final URL.

If you encounter a **loop**, return \`null\` instead of looping forever.`,
    examples: [
      { input: '{ "/a": "/b", "/b": "/c" }, "/a"', output: '"/c"' },
      { input: '{ "/x": "/y", "/y": "/x" }, "/x"', output: 'null' },
    ],
    constraints: '• ≤ 50 entries\n• At most 100 hops before declaring a loop',
    hints: ['Track visited URLs in a Set; when you revisit one, return null.'],
    starterCode: {
      javascript: `function resolveRedirect(redirects, start) {\n  // your code here\n}\n`,
    },
    functionName: 'resolveRedirect',
    testCases: [
      { args: [{}, '/home'],                                    expected: '/home' },
      { args: [{ '/a': '/b' }, '/a'],                           expected: '/b' },
      { args: [{ '/a': '/b', '/b': '/c' }, '/a'],               expected: '/c' },
      { args: [{ '/a': '/b', '/b': '/c', '/c': '/d' }, '/a'],   expected: '/d' },
      { args: [{ '/a': '/b' }, '/c'],                            expected: '/c' },
      { args: [{ '/x': '/y', '/y': '/x' }, '/x'],               expected: null },
      { args: [{ '/a': '/b', '/b': '/c', '/c': '/a' }, '/a'],   expected: null },
    ],
  },

  {
    slug: 'public-user-profile',
    title: 'Public User Profile',
    difficulty: 'EASY',
    category: 'backend',
    tags: 'api,security,objects',
    description:
`Backend APIs often need to return a safe public view of a user record.
Implement \`publicUser(user)\` that returns only:

* \`id\`
* \`username\`
* \`fullName\`
* \`avatarUrl\`

If \`fullName\` or \`avatarUrl\` is missing, return \`null\` for that field.
Never include private fields such as \`email\`, \`passwordHash\`, tokens, or role.`,
    examples: [
      { input: '{ id: 7, username: "alice", email: "a@example.com" }', output: '{ id: 7, username: "alice", fullName: null, avatarUrl: null }' },
    ],
    constraints: '• user is a plain object\n• id and username are always present',
    hints: ['Build a new object instead of deleting fields from the input.', 'Use nullish coalescing for optional fields.'],
    starterCode: {
      javascript:
`function publicUser(user) {
  // your code here
}
`,
      typescript:
`function publicUser(user: Record<string, any>): {
  id: number; username: string; fullName: string | null; avatarUrl: string | null;
} {
  return { id: 0, username: '', fullName: null, avatarUrl: null };
}
`,
      python:
`def publicUser(user):
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "fullName": user.get("fullName"),
        "avatarUrl": user.get("avatarUrl"),
    }
`,
      java:
`import java.util.*;

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
`,
      go:
`package main

func publicUser(user map[string]any) map[string]any {
    fullName, ok := user["fullName"]
    if !ok {
        fullName = nil
    }
    avatarURL, ok := user["avatarUrl"]
    if !ok {
        avatarURL = nil
    }
    return map[string]any{
        "id": user["id"],
        "username": user["username"],
        "fullName": fullName,
        "avatarUrl": avatarURL,
    }
}
`,
    },
    functionName: 'publicUser',
    testCases: [
      { args: [{ id: 1, username: 'demo', email: 'demo@example.com', passwordHash: 'secret', role: 'ADMIN' }],
        expected: { id: 1, username: 'demo', fullName: null, avatarUrl: null } },
      { args: [{ id: 2, username: 'alice', fullName: 'Alice A.', avatarUrl: '/a.png', accessToken: 'tok' }],
        expected: { id: 2, username: 'alice', fullName: 'Alice A.', avatarUrl: '/a.png' } },
      { args: [{ id: 3, username: 'bob', fullName: '', avatarUrl: undefined }],
        expected: { id: 3, username: 'bob', fullName: '', avatarUrl: null } },
      { args: [{ id: 4, username: 'carol', fullName: null, avatarUrl: null, refreshToken: 'hidden' }],
        expected: { id: 4, username: 'carol', fullName: null, avatarUrl: null } },
    ],
  },

  {
    slug: 'normalize-pagination-query',
    title: 'Normalize Pagination Query',
    difficulty: 'MEDIUM',
    category: 'backend',
    tags: 'api,pagination,validation',
    description:
`Implement \`normalizePagination(query)\` for REST endpoints that receive
\`page\` and \`pageSize\` from a query string.

Return:

\`\`\`
{ page, pageSize, offset }
\`\`\`

Rules:

* \`page\` defaults to \`1\`.
* \`pageSize\` defaults to \`20\`.
* Non-numeric, fractional, or negative values fall back to the default.
* \`pageSize\` is clamped to at most \`100\`.
* \`offset = (page - 1) * pageSize\`.`,
    examples: [
      { input: '{ page: "3", pageSize: "25" }', output: '{ page: 3, pageSize: 25, offset: 50 }' },
      { input: '{ page: "-1", pageSize: "999" }', output: '{ page: 1, pageSize: 100, offset: 0 }' },
    ],
    constraints: '• query is a plain object with optional string/number values',
    hints: ['Use Number.parseInt, then verify String(value) really represents an integer.', 'Clamp after applying defaults.'],
    starterCode: {
      javascript:
`function normalizePagination(query) {
  // your code here
}
`,
      typescript:
`function normalizePagination(query: Record<string, unknown>): {
  page: number; pageSize: number; offset: number;
} {
  return { page: 1, pageSize: 20, offset: 0 };
}
`,
      python:
`def normalizePagination(query):
    def int_value(value, default):
        if value is None:
            return default
        s = str(value).strip()
        if not s.isdigit():
            return default
        n = int(s)
        return n if n > 0 else default

    page = int_value(query.get("page"), 1)
    page_size = min(100, int_value(query.get("pageSize"), 20))
    return {"page": page, "pageSize": page_size, "offset": (page - 1) * page_size}
`,
      java:
`import java.util.*;

class Solution {
    public Map<String, Object> normalizePagination(Map<String, Object> query) {
        int page = intValue(query.get("page"), 1);
        int pageSize = Math.min(100, intValue(query.get("pageSize"), 20));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("page", page);
        out.put("pageSize", pageSize);
        out.put("offset", (page - 1) * pageSize);
        return out;
    }

    private int intValue(Object value, int fallback) {
        if (value == null) return fallback;
        String s = String.valueOf(value).trim();
        if (!s.matches("\\\\d+")) return fallback;
        int n = Integer.parseInt(s);
        return n > 0 ? n : fallback;
    }
}
`,
      go:
`package main

import (
    "strconv"
    "strings"
)

func normalizePagination(query map[string]any) map[string]any {
    page := intValue(query["page"], 1)
    pageSize := intValue(query["pageSize"], 20)
    if pageSize > 100 {
        pageSize = 100
    }
    return map[string]any{"page": page, "pageSize": pageSize, "offset": (page - 1) * pageSize}
}

func intValue(value any, fallback int) int {
    if value == nil {
        return fallback
    }
    s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(fmtValue(value), ".0"), ".00"))
    n, err := strconv.Atoi(s)
    if err != nil || n <= 0 {
        return fallback
    }
    return n
}

func fmtValue(value any) string {
    switch v := value.(type) {
    case string:
        return v
    case int:
        return strconv.Itoa(v)
    case float64:
        return strconv.FormatFloat(v, 'f', -1, 64)
    default:
        return ""
    }
}
`,
    },
    functionName: 'normalizePagination',
    testCases: [
      { args: [{}], expected: { page: 1, pageSize: 20, offset: 0 } },
      { args: [{ page: '3', pageSize: '25' }], expected: { page: 3, pageSize: 25, offset: 50 } },
      { args: [{ page: 2, pageSize: 10 }], expected: { page: 2, pageSize: 10, offset: 10 } },
      { args: [{ page: '0', pageSize: '0' }], expected: { page: 1, pageSize: 20, offset: 0 } },
      { args: [{ page: '-5', pageSize: '999' }], expected: { page: 1, pageSize: 100, offset: 0 } },
      { args: [{ page: '2.5', pageSize: 'abc' }], expected: { page: 1, pageSize: 20, offset: 0 } },
      { args: [{ page: ' 4 ', pageSize: ' 5 ' }], expected: { page: 4, pageSize: 5, offset: 15 } },
    ],
  },
];
