/**
 * Frontend-flavoured JavaScript practice problems.
 *
 * Pure functions students would write in a UI codebase: formatters,
 * tree filters, breadcrumbs, pagination components, etc.
 */

export const FRONTEND_PROBLEMS = [
  {
    slug: 'format-bytes',
    title: 'Format Bytes',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'formatting,strings',
    description:
`Implement \`formatBytes(n)\` to render a byte count in a friendly form
that you'd show in a file-upload UI.

* Use binary units (1024-based): \`B\`, \`KB\`, \`MB\`, \`GB\`, \`TB\`.
* Show **at most 2 decimal digits**, but never trailing zeros (\`"1 KB"\`, not \`"1.00 KB"\`).
* \`0\` returns \`"0 B"\`.
* Negative inputs return \`"-"\` followed by the formatted absolute value.
* Round half-away-from-zero — \`1536\` → \`"1.5 KB"\`, \`1023\` → \`"1023 B"\`.`,
    examples: [
      { input: '0',         output: '"0 B"' },
      { input: '1023',      output: '"1023 B"' },
      { input: '1024',      output: '"1 KB"' },
      { input: '1536',      output: '"1.5 KB"' },
      { input: '1048576',   output: '"1 MB"' },
      { input: '5_000_000_000', output: '"4.66 GB"' },
    ],
    constraints: '• -2⁵³ < n < 2⁵³',
    hints: ['Pick the unit by Math.floor(Math.log(n) / Math.log(1024)).', 'Use toFixed(2) then trim trailing zeros / "."'],
    starterCode: {
      javascript: `function formatBytes(n) {\n  // your code here\n}\n`,
    },
    functionName: 'formatBytes',
    testCases: [
      { args: [0],          expected: '0 B' },
      { args: [1],          expected: '1 B' },
      { args: [1023],       expected: '1023 B' },
      { args: [1024],       expected: '1 KB' },
      { args: [1536],       expected: '1.5 KB' },
      { args: [1048576],    expected: '1 MB' },
      { args: [-1024],      expected: '-1 KB' },
      { args: [5000000000], expected: '4.66 GB' },
    ],
  },

  {
    slug: 'format-relative-time',
    title: 'Relative Time',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'date,strings',
    description:
`Implement \`timeAgo(date, now)\` returning a human-readable relative time string.
Both arguments are millisecond timestamps. Buckets:

* < 60s        → \`"just now"\`
* < 60m        → \`"<n>m ago"\`
* < 24h        → \`"<n>h ago"\`
* < 30d        → \`"<n>d ago"\`
* < 12 months  → \`"<n>mo ago"\` (treat 1 month = 30 days)
* otherwise    → \`"<n>y ago"\`  (treat 1 year = 365 days)

If \`date > now\` use \`"in <bucket>"\` form (\`"in 5m"\`, \`"in 1d"\`).
Round **down** in all buckets.`,
    examples: [
      { input: 'now,           now',           output: '"just now"' },
      { input: 'now-90_000,    now',           output: '"1m ago"' },
      { input: 'now+3*3600_000,now',           output: '"in 3h"' },
    ],
    constraints: '• Inputs are valid timestamps.',
    hints: ['Compute the diff in seconds, then walk the buckets.'],
    starterCode: {
      javascript: `function timeAgo(date, now) {\n  // your code here\n}\n`,
    },
    functionName: 'timeAgo',
    testCases: [
      { args: [1_000_000, 1_000_000],                expected: 'just now' },
      { args: [1_000_000, 1_000_000 + 30_000],       expected: 'just now' },
      { args: [1_000_000, 1_000_000 + 90_000],       expected: '1m ago' },
      { args: [1_000_000, 1_000_000 + 600_000],      expected: '10m ago' },
      { args: [1_000_000, 1_000_000 + 3 * 3600_000], expected: '3h ago' },
      { args: [1_000_000, 1_000_000 + 86_400_000 * 5],  expected: '5d ago' },
      { args: [1_000_000, 1_000_000 + 86_400_000 * 60], expected: '2mo ago' },
      { args: [1_000_000, 1_000_000 + 86_400_000 * 400], expected: '1y ago' },
      { args: [1_000_000 + 90_000, 1_000_000],       expected: 'in 1m' },
      { args: [1_000_000 + 3 * 3600_000, 1_000_000], expected: 'in 3h' },
    ],
  },

  {
    slug: 'kebab-case',
    title: 'Convert to kebab-case',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'strings',
    description:
`Implement \`toKebab(input)\` that converts any of these forms into kebab-case:

* camelCase            → kebab-case
* PascalCase           → kebab-case
* snake_case           → kebab-case
* Already-kebab        → kebab-case
* "Mixed CASE words"   → kebab-case

Rules:

* Insert a \`-\` before each uppercase letter that's preceded by a lowercase or digit.
* Replace any non-alphanumeric run with a single \`-\`.
* Trim leading and trailing \`-\` and lowercase the whole result.`,
    examples: [
      { input: '"helloWorld"',     output: '"hello-world"' },
      { input: '"PascalCase"',     output: '"pascal-case"' },
      { input: '"snake_case_v2"',  output: '"snake-case-v2"' },
      { input: '"  Mixed  CASE "', output: '"mixed-case"' },
    ],
    constraints: '• Length ≤ 200.',
    hints: ['Two regex passes: insert "-" before capitals, then collapse non-alphanumerics.'],
    starterCode: {
      javascript: `function toKebab(input) {\n  // your code here\n}\n`,
    },
    functionName: 'toKebab',
    testCases: [
      { args: ['helloWorld'],     expected: 'hello-world' },
      { args: ['PascalCase'],     expected: 'pascal-case' },
      { args: ['snake_case_v2'],  expected: 'snake-case-v2' },
      { args: ['  Mixed  CASE '], expected: 'mixed-case' },
      { args: ['kebab-case'],     expected: 'kebab-case' },
      { args: ['XMLHttpRequest'], expected: 'xmlhttp-request' },
      { args: ['ABC'],            expected: 'abc' },
      { args: [''],               expected: '' },
    ],
  },

  {
    slug: 'chunk-array',
    title: 'Chunk an Array',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'arrays',
    description:
`Implement \`chunk(array, size)\` that splits \`array\` into groups of length
\`size\`. The last chunk may be smaller. \`size\` ≤ 0 returns \`[]\`.

This is what you'd use to lay out a gallery into rows of *N* items.`,
    examples: [
      { input: '[1,2,3,4,5], 2', output: '[[1,2],[3,4],[5]]' },
      { input: '[], 3',          output: '[]' },
      { input: '[1,2,3], 0',     output: '[]' },
    ],
    constraints: '• 0 ≤ array.length ≤ 10⁴',
    hints: ['for-loop with step `size` and slice(i, i+size).'],
    starterCode: {
      javascript: `function chunk(array, size) {\n  // your code here\n}\n`,
    },
    functionName: 'chunk',
    testCases: [
      { args: [[1,2,3,4,5], 2], expected: [[1,2],[3,4],[5]] },
      { args: [[1,2,3,4,5,6], 3], expected: [[1,2,3],[4,5,6]] },
      { args: [[], 3], expected: [] },
      { args: [[1,2,3], 0], expected: [] },
      { args: [[1,2,3], -1], expected: [] },
      { args: [[1,2,3], 10], expected: [[1,2,3]] },
    ],
  },

  {
    slug: 'paginate-pager',
    title: 'Render Pagination Pages',
    difficulty: 'MEDIUM',
    category: 'frontend',
    tags: 'pagination,ui',
    description:
`Build the array of page tokens that a typical pagination component renders:

\`\`\`
getPages(current, total) → ['1', '...', '4', '5', '6', '...', '10']
\`\`\`

Rules:

* Always include the first and last page.
* Always include \`current\`, \`current - 1\`, and \`current + 1\`.
* If two adjacent emitted pages would be **more than 2 apart** (i.e. would
  hide more than one number), put a single \`'...'\` between them. If only
  one number would be hidden, include it instead.
* All page numbers are returned as **strings** so the component can render
  them uniformly. The literal \`'...'\` is also a string.

If \`total ≤ 7\`, return all pages without ellipses.`,
    examples: [
      { input: '5, 10', output: "['1','...','4','5','6','...','10']" },
      { input: '1, 5',  output: "['1','2','3','4','5']" },
      { input: '7, 10', output: "['1','...','6','7','8','9','10']" },
    ],
    constraints: '• 1 ≤ current ≤ total ≤ 1000',
    hints: ['First build a Set of page numbers to keep, then walk 1..total inserting "..." for gaps.'],
    starterCode: {
      javascript: `function getPages(current, total) {\n  // your code here\n}\n`,
    },
    functionName: 'getPages',
    testCases: [
      { args: [5, 10], expected: ['1','...','4','5','6','...','10'] },
      { args: [1, 5],  expected: ['1','2','3','4','5'] },
      { args: [7, 10], expected: ['1','...','6','7','8','9','10'] },
      { args: [1, 10], expected: ['1','2','...','10'] },
      { args: [10, 10], expected: ['1','...','9','10'] },
      { args: [3, 7],  expected: ['1','2','3','4','5','6','7'] },
      { args: [50, 100], expected: ['1','...','49','50','51','...','100'] },
    ],
  },

  {
    slug: 'highlight-search',
    title: 'Highlight Search Matches',
    difficulty: 'MEDIUM',
    category: 'frontend',
    tags: 'strings,search',
    description:
`Given a text and a search query, return an array of segments
\`{ text: string, match: boolean }\` so that the UI can wrap matched
parts in \`<mark>\`.

* Matching is **case-insensitive**.
* Empty query returns a single non-match segment containing the original text.
* Do **not** lose any character — the joined \`text\` of all segments equals
  the original string.
* Matches must be non-overlapping; once one is taken, advance past it.`,
    examples: [
      { input: '"Hello World", "world"', output: "[{text:'Hello ',match:false},{text:'World',match:true}]" },
      { input: '"banana", "an"',          output: "[{text:'b',match:false},{text:'an',match:true},{text:'an',match:true},{text:'a',match:false}]" },
    ],
    constraints: '• 0 ≤ text.length ≤ 1000',
    hints: ['toLowerCase both sides for the index search; slice with the original-cased text.'],
    starterCode: {
      javascript: `function highlight(text, query) {\n  // your code here\n}\n`,
    },
    functionName: 'highlight',
    testCases: [
      { args: ['', 'foo'], expected: [] },
      { args: ['Hello World', ''],
        expected: [{ text: 'Hello World', match: false }] },
      { args: ['Hello World', 'world'],
        expected: [{ text: 'Hello ', match: false }, { text: 'World', match: true }] },
      { args: ['banana', 'an'],
        expected: [
          { text: 'b', match: false },
          { text: 'an', match: true },
          { text: 'an', match: true },
          { text: 'a', match: false },
        ] },
      { args: ['No match here', 'XYZ'],
        expected: [{ text: 'No match here', match: false }] },
      { args: ['Aaaa', 'a'],
        expected: [
          { text: 'A', match: true },
          { text: 'a', match: true },
          { text: 'a', match: true },
          { text: 'a', match: true },
        ] },
    ],
  },

  {
    slug: 'breadcrumbs',
    title: 'Build Breadcrumbs',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'routing,strings',
    description:
`Convert a URL path into an array of breadcrumbs that's safe to render in a
\`<nav>\`. Each segment becomes \`{ label, href }\`:

* The first crumb is always \`{ label: 'Home', href: '/' }\`.
* For each subsequent segment, decode it with \`decodeURIComponent\` and
  capitalise the first letter. Replace \`-\` with spaces.
* \`href\` is the cumulative path including the leading \`/\`.
* Trailing \`/\` is ignored.
* The root path \`/\` returns just the Home crumb.`,
    examples: [
      { input: '"/products/cool-shoes/123"', output:
        "[{label:'Home',href:'/'},{label:'Products',href:'/products'},{label:'Cool shoes',href:'/products/cool-shoes'},{label:'123',href:'/products/cool-shoes/123'}]" },
    ],
    constraints: '• Path length ≤ 200',
    hints: ['Split on "/" and filter out empties.', 'Accumulate the href as you go.'],
    starterCode: {
      javascript: `function breadcrumbs(path) {\n  // your code here\n}\n`,
    },
    functionName: 'breadcrumbs',
    testCases: [
      { args: ['/'],      expected: [{ label: 'Home', href: '/' }] },
      { args: [''],       expected: [{ label: 'Home', href: '/' }] },
      { args: ['/products'],
        expected: [{ label: 'Home', href: '/' }, { label: 'Products', href: '/products' }] },
      { args: ['/products/cool-shoes/'],
        expected: [
          { label: 'Home', href: '/' },
          { label: 'Products', href: '/products' },
          { label: 'Cool shoes', href: '/products/cool-shoes' },
        ] },
      { args: ['/products/cool-shoes/123'],
        expected: [
          { label: 'Home', href: '/' },
          { label: 'Products', href: '/products' },
          { label: 'Cool shoes', href: '/products/cool-shoes' },
          { label: '123', href: '/products/cool-shoes/123' },
        ] },
      { args: ['/users/john%20doe'],
        expected: [
          { label: 'Home', href: '/' },
          { label: 'Users', href: '/users' },
          { label: 'John doe', href: '/users/john%20doe' },
        ] },
    ],
  },

  {
    slug: 'cart-total',
    title: 'Shopping Cart Total',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'commerce,arrays',
    description:
`Implement \`cartTotal(items)\` that returns a totals breakdown for a cart:

\`\`\`
{ subtotal, discount, total }   // numbers, rounded to 2 decimals
\`\`\`

Each item is \`{ price, qty, discount? }\`. \`discount\` is a percentage between
0 and 100 applied to that line item. \`subtotal\` is the sum of \`price * qty\`,
\`discount\` is the sum of discount amounts, \`total\` is \`subtotal - discount\`.`,
    examples: [
      { input: '[{price:10,qty:2}, {price:20,qty:1,discount:50}]',
        output: '{ subtotal: 40, discount: 10, total: 30 }' },
    ],
    constraints: '• 0 ≤ items.length ≤ 100',
    hints: ['Round each running total with Math.round(x * 100) / 100 to avoid FP drift.'],
    starterCode: {
      javascript: `function cartTotal(items) {\n  // your code here\n}\n`,
    },
    functionName: 'cartTotal',
    testCases: [
      { args: [[]],
        expected: { subtotal: 0, discount: 0, total: 0 } },
      { args: [[{ price: 10, qty: 2 }]],
        expected: { subtotal: 20, discount: 0, total: 20 } },
      { args: [[{ price: 10, qty: 2 }, { price: 20, qty: 1, discount: 50 }]],
        expected: { subtotal: 40, discount: 10, total: 30 } },
      { args: [[{ price: 9.99, qty: 3 }]],
        expected: { subtotal: 29.97, discount: 0, total: 29.97 } },
      { args: [[{ price: 100, qty: 1, discount: 100 }]],
        expected: { subtotal: 100, discount: 100, total: 0 } },
    ],
  },

  {
    slug: 'flatten-tree',
    title: 'Flatten Category Tree',
    difficulty: 'MEDIUM',
    category: 'frontend',
    tags: 'trees,recursion',
    description:
`A common pattern for sidebars and selects is to flatten a nested category
tree into a list with \`depth\` for indentation:

\`\`\`
{ id, name, children?: Node[] }   ──►   [ { id, name, depth }, ... ]
\`\`\`

Walk the tree depth-first, in the order children appear. \`depth\` of root
nodes is \`0\`, their direct children are \`1\`, and so on.`,
    examples: [
      { input: '[{id:1,name:"a",children:[{id:2,name:"b"}]}]',
        output: '[{id:1,name:"a",depth:0},{id:2,name:"b",depth:1}]' },
    ],
    constraints: '• ≤ 1000 nodes total',
    hints: ['Recursive helper with a depth parameter, append to the result.'],
    starterCode: {
      javascript: `function flattenTree(nodes) {\n  // your code here\n}\n`,
    },
    functionName: 'flattenTree',
    testCases: [
      { args: [[]], expected: [] },
      { args: [[{ id: 1, name: 'a' }]],
        expected: [{ id: 1, name: 'a', depth: 0 }] },
      { args: [[{ id: 1, name: 'a', children: [{ id: 2, name: 'b' }] }]],
        expected: [{ id: 1, name: 'a', depth: 0 }, { id: 2, name: 'b', depth: 1 }] },
      { args: [[
          { id: 1, name: 'a', children: [
            { id: 2, name: 'b', children: [{ id: 3, name: 'c' }] },
            { id: 4, name: 'd' },
          ] },
          { id: 5, name: 'e' },
        ]],
        expected: [
          { id: 1, name: 'a', depth: 0 },
          { id: 2, name: 'b', depth: 1 },
          { id: 3, name: 'c', depth: 2 },
          { id: 4, name: 'd', depth: 1 },
          { id: 5, name: 'e', depth: 0 },
        ] },
    ],
  },

  {
    slug: 'filter-tree',
    title: 'Filter Category Tree',
    difficulty: 'MEDIUM',
    category: 'frontend',
    tags: 'trees,search',
    description:
`Implement \`filterTree(nodes, query)\` that returns a new tree of the same
shape, keeping only nodes whose \`name\` contains \`query\` (case-insensitive),
**plus all ancestors of matched nodes**. A parent that doesn't match is
included if any descendant matches.

If \`query\` is empty, return the original tree.

Original nodes must not be mutated.`,
    examples: [
      { input: 'tree, "foo"',
        output: 'subtree containing all branches that lead to a "foo" match' },
    ],
    constraints: '• ≤ 500 nodes',
    hints: ['Recursive: filter children first, then keep self if name matches OR any kept child exists.'],
    starterCode: {
      javascript: `function filterTree(nodes, query) {\n  // your code here\n}\n`,
    },
    functionName: 'filterTree',
    testCases: [
      { args: [[], 'x'], expected: [] },
      { args: [[{ id: 1, name: 'apple' }], ''],
        expected: [{ id: 1, name: 'apple' }] },
      { args: [[{ id: 1, name: 'apple' }, { id: 2, name: 'banana' }], 'app'],
        expected: [{ id: 1, name: 'apple' }] },
      { args: [[
          { id: 1, name: 'fruit', children: [
            { id: 2, name: 'apple' },
            { id: 3, name: 'banana' },
          ] },
        ], 'app'],
        expected: [
          { id: 1, name: 'fruit', children: [{ id: 2, name: 'apple' }] },
        ] },
      { args: [[
          { id: 1, name: 'a', children: [
            { id: 2, name: 'b' },
            { id: 3, name: 'c' },
          ] },
        ], 'X'],
        expected: [] },
    ],
  },

  {
    slug: 'class-names',
    title: 'Compose CSS Class Names',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'ui,strings,components',
    description:
`Implement \`classNames(...values)\`, a tiny helper for building a React
\`className\` string.

Accepted values:

* strings — included when non-empty;
* arrays — processed recursively;
* objects — include the key when its value is truthy;
* falsy values (\`false\`, \`null\`, \`undefined\`, \`0\`, \`""\`) are skipped.

Return classes joined with a single space, preserving encounter order.`,
    examples: [
      { input: '"btn", { active: true, hidden: false }', output: '"btn active"' },
      { input: '["p-2", ["text-sm"]], null, "rounded"', output: '"p-2 text-sm rounded"' },
    ],
    constraints: '• Inputs contain only strings, arrays, objects, and primitive falsy values.',
    hints: ['Use a recursive helper that pushes tokens into one output array.'],
    starterCode: {
      javascript: `function classNames(...values) {\n  // your code here\n}\n`,
      typescript: `function classNames(...values: any[]): string {\n  return '';\n}\n`,
      python:
`def classNames(*values):
    return ""
`,
      java:
`import java.util.*;

class Solution {
    public String classNames(Object... values) {
        return "";
    }
}
`,
      go:
`package main

func classNames(values ...any) string {
    return ""
}
`,
    },
    functionName: 'classNames',
    testCases: [
      { args: ['btn', 'primary'], expected: 'btn primary' },
      { args: ['btn', { active: true, disabled: false }], expected: 'btn active' },
      { args: [['p-2', ['text-sm']], null, undefined, 'rounded'], expected: 'p-2 text-sm rounded' },
      { args: ['', false, 0, null], expected: '' },
      { args: ['card', { selected: 1, hidden: 0 }, ['shadow', { dark: true }]], expected: 'card selected shadow dark' },
    ],
  },

  {
    slug: 'toggle-selection',
    title: 'Toggle Selection State',
    difficulty: 'EASY',
    category: 'frontend',
    tags: 'state,arrays,ui',
    description:
`Implement \`toggleSelection(selected, id, multi)\` for checkbox/list UI state.

* \`selected\` is an array of ids.
* In multi-select mode (\`multi === true\`), clicking an existing id removes it;
  clicking a missing id appends it to the end.
* In single-select mode, clicking a missing id returns \`[id]\`; clicking the
  already selected id clears the selection.
* Never mutate the input array.`,
    examples: [
      { input: '[1, 2], 3, true', output: '[1, 2, 3]' },
      { input: '[1, 2], 2, true', output: '[1]' },
      { input: '[1], 1, false', output: '[]' },
    ],
    constraints: '• ids are strings or numbers\n• selected.length ≤ 1000',
    hints: ['Use includes to decide whether the id is currently selected.', 'Return new arrays with filter/spread.'],
    starterCode: {
      javascript: `function toggleSelection(selected, id, multi) {\n  // your code here\n}\n`,
      typescript: `function toggleSelection<T>(selected: T[], id: T, multi: boolean): T[] {\n  return [];\n}\n`,
      python:
`def toggleSelection(selected, id, multi):
    return []
`,
      java:
`import java.util.*;

class Solution {
    public List<Object> toggleSelection(List<Object> selected, Object id, boolean multi) {
        return new ArrayList<>();
    }
}
`,
      go:
`package main

func toggleSelection(selected []any, id any, multi bool) []any {
    return []any{}
}
`,
    },
    functionName: 'toggleSelection',
    testCases: [
      { args: [[], 1, true], expected: [1] },
      { args: [[1, 2], 3, true], expected: [1, 2, 3] },
      { args: [[1, 2, 3], 2, true], expected: [1, 3] },
      { args: [[1, 2], 3, false], expected: [3] },
      { args: [[1], 1, false], expected: [] },
      { args: [['a', 'b'], 'b', true], expected: ['a'] },
    ],
  },
];
