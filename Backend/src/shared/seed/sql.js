/**
 * SQL practice problems.
 *
 * Each problem ships its own DDL + DML in `sqlSetup`. The judge spins up
 * a fresh in-memory SQLite for every test case, runs the setup, then
 * executes the user's query and diffs the rows.
 */

/* Common e-commerce schema reused by several problems. */
const SHOP_SCHEMA = `
CREATE TABLE customers (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  country TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE TABLE products (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  price  REAL NOT NULL,
  stock  INTEGER NOT NULL
);
CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  total       REAL NOT NULL,
  status      TEXT NOT NULL,
  placed_at   TEXT NOT NULL
);
CREATE TABLE order_items (
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
INSERT INTO customers VALUES
  (1, 'Alice',   'US', '2024-01-15'),
  (2, 'Bob',     'GB', '2024-02-03'),
  (3, 'Charlie', 'US', '2024-02-12'),
  (4, 'Dora',    'FR', '2024-03-20'),
  (5, 'Erik',    'DE', '2024-04-01'),
  (6, 'Fiona',   'GB', '2024-04-15');
INSERT INTO products VALUES
  (1, 'Mechanical Keyboard',  120.0, 14),
  (2, 'Wireless Mouse',        45.0, 80),
  (3, 'USB-C Hub',             25.5,  0),
  (4, 'Standing Desk',        320.0,  3),
  (5, 'Webcam',                75.0, 22),
  (6, '4K Monitor',           450.0,  5);
INSERT INTO orders VALUES
  (101, 1, 165.0, 'PAID',     '2024-05-01'),
  (102, 1,  45.0, 'PAID',     '2024-05-04'),
  (103, 2, 120.0, 'PAID',     '2024-05-06'),
  (104, 3, 770.0, 'PAID',     '2024-05-10'),
  (105, 3,  25.5, 'CANCELLED','2024-05-11'),
  (106, 4, 450.0, 'PAID',     '2024-05-15'),
  (107, 5,  75.0, 'REFUNDED', '2024-05-18'),
  (108, 1,  45.0, 'PAID',     '2024-05-22');
INSERT INTO order_items VALUES
  (101, 1, 1), (101, 2, 1),
  (102, 2, 1),
  (103, 1, 1),
  (104, 4, 2), (104, 6, 1), (104, 5, 2),
  (105, 3, 1),
  (106, 6, 1),
  (107, 5, 1),
  (108, 2, 1);
`;

/* Schema for window-function / employee problems. */
const HR_SCHEMA = `
CREATE TABLE departments (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE employees (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  manager_id    INTEGER REFERENCES employees(id),
  salary        REAL NOT NULL,
  hired_at      TEXT NOT NULL
);
INSERT INTO departments VALUES
  (1, 'Engineering'), (2, 'Sales'), (3, 'Support');
INSERT INTO employees VALUES
  (1, 'Alice',  1, NULL, 180000, '2018-03-01'),
  (2, 'Bob',    1,    1, 120000, '2019-06-15'),
  (3, 'Carol',  1,    1, 130000, '2020-01-10'),
  (4, 'Dan',    1,    1, 110000, '2022-08-22'),
  (5, 'Erin',   2, NULL, 150000, '2018-05-12'),
  (6, 'Frank',  2,    5,  90000, '2021-02-04'),
  (7, 'Greta',  2,    5,  95000, '2021-09-19'),
  (8, 'Helen',  3, NULL, 100000, '2019-11-08'),
  (9, 'Igor',   3,    8,  60000, '2023-04-25');
`;

/* Simple users + posts schema. */
const BLOG_SCHEMA = `
CREATE TABLE users (
  id       INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  signup   TEXT NOT NULL
);
CREATE TABLE posts (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title   TEXT NOT NULL,
  likes   INTEGER NOT NULL,
  posted  TEXT NOT NULL
);
INSERT INTO users VALUES
  (1, 'alice',   '2024-01-01'),
  (2, 'bob',     '2024-01-15'),
  (3, 'carol',   '2024-02-01'),
  (4, 'dan',     '2024-03-12'),
  (5, 'erin',    '2024-04-01');
INSERT INTO posts VALUES
  (1, 1, 'Hello world',  20, '2024-02-01'),
  (2, 1, 'Async Rust',   95, '2024-02-15'),
  (3, 2, 'My setup',      5, '2024-02-20'),
  (4, 3, 'Tasty pasta',  40, '2024-03-05'),
  (5, 3, 'Sourdough',    30, '2024-03-12'),
  (6, 4, 'New PR',       12, '2024-03-30');
`;

export const SQL_PROBLEMS = [
  {
    slug: 'sql-select-all-customers',
    title: 'List All Customers',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'select,basics',
    description:
`Return every column of every row in the \`customers\` table.

The result should have **id, name, country, created** — exactly the
columns from the table — and contain all 6 customers.`,
    examples: [
      { input: 'SELECT all customers', output:
`id | name    | country | created
 1 | Alice   | US      | 2024-01-15
 2 | Bob     | GB      | 2024-02-03
…` },
    ],
    constraints: '• 6 customers in the seed data.',
    hints: ['SELECT * FROM …'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: '-- Your SQL here\nSELECT\n' },
    testCases: [
      {
        expected: [
          [1, 'Alice',   'US', '2024-01-15'],
          [2, 'Bob',     'GB', '2024-02-03'],
          [3, 'Charlie', 'US', '2024-02-12'],
          [4, 'Dora',    'FR', '2024-03-20'],
          [5, 'Erik',    'DE', '2024-04-01'],
          [6, 'Fiona',   'GB', '2024-04-15'],
        ],
      },
    ],
  },

  {
    slug: 'sql-customers-from-us',
    title: 'Customers From the US',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'where,filtering',
    description:
`Return the **id and name** of every customer whose country is \`'US'\`,
ordered by id ascending.`,
    examples: [
      { input: 'WHERE country = "US"', output: '[(1, "Alice"), (3, "Charlie")]' },
    ],
    constraints: '• Output exactly 2 columns.',
    hints: ['SELECT id, name FROM customers WHERE country = ? ORDER BY id'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT id, name\nFROM customers\nWHERE\nORDER BY id;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          [1, 'Alice'],
          [3, 'Charlie'],
        ],
      },
    ],
  },

  {
    slug: 'sql-distinct-countries',
    title: 'Distinct Countries',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'distinct,select',
    description:
`Return a single column \`country\` containing each country that appears in
the \`customers\` table — no duplicates. Order doesn't matter.`,
    examples: [
      { input: '—', output: 'US, GB, FR, DE (in any order)' },
    ],
    constraints: '• Use SELECT DISTINCT.',
    hints: ['SELECT DISTINCT country FROM customers'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT DISTINCT\nFROM customers;\n' },
    testCases: [
      {
        expected: [
          ['US'], ['GB'], ['FR'], ['DE'],
        ],
      },
    ],
  },

  {
    slug: 'sql-products-by-price',
    title: 'Products by Price',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'order by,limit',
    description:
`Return the **3 most expensive** products from the \`products\` table.
Output the columns \`name\` and \`price\`, ordered by price descending.

If two products have the same price, ties may resolve in any order.`,
    examples: [],
    constraints: '• Output exactly 3 rows.',
    hints: ['ORDER BY price DESC LIMIT 3'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT name, price\nFROM products\nORDER BY\nLIMIT;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['4K Monitor',          450.0],
          ['Standing Desk',       320.0],
          ['Mechanical Keyboard', 120.0],
        ],
      },
    ],
  },

  {
    slug: 'sql-customers-per-country',
    title: 'Customers Per Country',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'group by,aggregation',
    description:
`Return one row per country, with two columns:

* \`country\` — the country code,
* \`customer_count\` — how many customers come from that country.

Order doesn't matter.`,
    examples: [
      { input: '—', output: '[(US,2), (GB,2), (FR,1), (DE,1)]' },
    ],
    constraints: '• Use GROUP BY.',
    hints: ['SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT country, COUNT(*) AS customer_count\nFROM customers\nGROUP BY country;\n' },
    testCases: [
      {
        expected: [
          ['US', 2],
          ['GB', 2],
          ['FR', 1],
          ['DE', 1],
        ],
      },
    ],
  },

  {
    slug: 'sql-orders-with-customer-names',
    title: 'Orders With Customer Names',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'join,inner join',
    description:
`Return one row per order, with the columns:

* \`order_id\`,
* \`customer_name\`,
* \`total\`.

Only \`PAID\` orders should be included. Order by \`order_id\` ascending.`,
    examples: [],
    constraints: '• Use an INNER JOIN.',
    hints: ['JOIN customers ON customers.id = orders.customer_id'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT o.id AS order_id, c.name AS customer_name, o.total\nFROM orders o\nJOIN customers c ON\nWHERE o.status = \'PAID\'\nORDER BY o.id;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          [101, 'Alice',   165.0],
          [102, 'Alice',    45.0],
          [103, 'Bob',     120.0],
          [104, 'Charlie', 770.0],
          [106, 'Dora',    450.0],
          [108, 'Alice',    45.0],
        ],
      },
    ],
  },

  {
    slug: 'sql-customers-without-orders',
    title: 'Customers With No Orders',
    difficulty: 'MEDIUM',
    category: 'sql',
    tags: 'left join,is null',
    description:
`Return the **id and name** of every customer who has placed no orders
(no row in the \`orders\` table for them at all). Order by id ascending.`,
    examples: [],
    constraints: '• Use LEFT JOIN ... IS NULL or NOT EXISTS.',
    hints: [
      'LEFT JOIN orders ON ... WHERE orders.id IS NULL',
      'or: WHERE NOT EXISTS (SELECT 1 FROM orders WHERE customer_id = customers.id)',
    ],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT c.id, c.name\nFROM customers c\nLEFT JOIN orders o ON\nWHERE o.id IS NULL\nORDER BY c.id;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          [6, 'Fiona'],
        ],
      },
    ],
  },

  {
    slug: 'sql-top-spenders',
    title: 'Top Spenders (HAVING)',
    difficulty: 'MEDIUM',
    category: 'sql',
    tags: 'group by,having,join',
    description:
`Return customers who have spent **more than $200** in total across
their \`PAID\` orders. Output two columns:

* \`name\` (customer name),
* \`total_spent\` (sum of \`total\` for their PAID orders).

Order by \`total_spent\` descending.`,
    examples: [],
    constraints: '• Use HAVING.',
    hints: ['GROUP BY customer_id then HAVING SUM(total) > 200'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT c.name, SUM(o.total) AS total_spent\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE\nGROUP BY c.id\nHAVING\nORDER BY total_spent DESC;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['Charlie', 770.0],
          ['Dora',    450.0],
          ['Alice',   255.0],
        ],
      },
    ],
  },

  {
    slug: 'sql-out-of-stock',
    title: 'Out-of-Stock Products',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'where,filtering',
    description:
`Return the \`id\` and \`name\` of every product whose \`stock\` is 0.
Order by \`id\` ascending.`,
    examples: [],
    constraints: '',
    hints: ['WHERE stock = 0'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT id, name\nFROM products\nWHERE\nORDER BY id;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          [3, 'USB-C Hub'],
        ],
      },
    ],
  },

  {
    slug: 'sql-product-revenue',
    title: 'Revenue Per Product',
    difficulty: 'MEDIUM',
    category: 'sql',
    tags: 'join,group by,aggregation',
    description:
`Compute the total revenue (\`SUM(qty * price)\`) generated by each product
across all \`PAID\` orders. Output two columns:

* \`name\` (product name),
* \`revenue\` (total).

Include only products that produced **strictly positive** revenue.
Order by \`revenue\` descending.`,
    examples: [],
    constraints: '• Join order_items + products + orders, filter by status.',
    hints: ['Three-way join: order_items × products × orders.', 'SUM(oi.qty * p.price).'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT p.name, SUM(oi.qty * p.price) AS revenue\nFROM products p\nJOIN order_items oi ON oi.product_id = p.id\nJOIN orders o     ON o.id = oi.order_id\nWHERE o.status = \'PAID\'\nGROUP BY p.id\nHAVING revenue > 0\nORDER BY revenue DESC;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['4K Monitor',          900.0],
          ['Standing Desk',       640.0],
          ['Mechanical Keyboard', 240.0],
          ['Webcam',              150.0],
          ['Wireless Mouse',      135.0],
        ],
      },
    ],
  },

  {
    slug: 'sql-employee-manager',
    title: 'Employees and Their Managers',
    difficulty: 'MEDIUM',
    category: 'sql',
    tags: 'self join',
    description:
`Return one row per employee with two columns:

* \`employee\` — the employee's name,
* \`manager\` — the manager's name, or \`NULL\` if they don't have one.

Order by \`employee\` ascending.`,
    examples: [],
    constraints: '• Use a LEFT self-join on employees.',
    hints: ['LEFT JOIN employees m ON m.id = e.manager_id'],
    sqlSetup: HR_SCHEMA,
    starterCode: { sql: 'SELECT e.name AS employee, m.name AS manager\nFROM employees e\nLEFT JOIN employees m ON\nORDER BY employee;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['Alice',  null],
          ['Bob',   'Alice'],
          ['Carol', 'Alice'],
          ['Dan',   'Alice'],
          ['Erin',   null],
          ['Frank', 'Erin'],
          ['Greta', 'Erin'],
          ['Helen',  null],
          ['Igor',  'Helen'],
        ],
      },
    ],
  },

  {
    slug: 'sql-second-highest-salary',
    title: 'Second-Highest Salary Per Department',
    difficulty: 'MEDIUM',
    category: 'sql',
    tags: 'subquery,group by',
    description:
`For each department return the employee with the **second-highest** salary.
Output:

* \`department\` (name),
* \`employee\`   (employee name),
* \`salary\`.

If a department has fewer than 2 employees it should not appear in the result.
Treat ties by salary as distinct rows (i.e. you can rely on the seed data
having no salary ties within a department).`,
    examples: [],
    constraints: '',
    hints: [
      'A correlated subquery / window function works.',
      'WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC) rn FROM employees)',
    ],
    sqlSetup: HR_SCHEMA,
    starterCode: { sql: 'WITH ranked AS (\n  SELECT e.*,\n         ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC) rn\n  FROM employees e\n)\nSELECT d.name AS department, r.name AS employee, r.salary\nFROM ranked r\nJOIN departments d ON d.id = r.department_id\nWHERE r.rn = 2;\n' },
    testCases: [
      {
        expected: [
          ['Engineering', 'Carol',  130000.0],
          ['Sales',       'Greta',   95000.0],
          ['Support',     'Igor',    60000.0],
        ],
      },
    ],
  },

  {
    slug: 'sql-rank-by-salary',
    title: 'Rank Employees By Salary',
    difficulty: 'HARD',
    category: 'sql',
    tags: 'window function,rank',
    description:
`Return one row per employee with the columns:

* \`name\`,
* \`salary\`,
* \`dept_rank\` — the employee's rank **within their department**,
  ordered by salary descending. Tied salaries get the same rank
  (use \`RANK()\`, not \`DENSE_RANK\`).

Order by \`department_id\`, then \`dept_rank\` ascending.`,
    examples: [],
    constraints: '• Use a window function.',
    hints: ['RANK() OVER (PARTITION BY department_id ORDER BY salary DESC)'],
    sqlSetup: HR_SCHEMA,
    starterCode: { sql: 'SELECT name, salary,\n       RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS dept_rank\nFROM employees\nORDER BY department_id, dept_rank;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['Alice',  180000.0, 1],
          ['Carol',  130000.0, 2],
          ['Bob',    120000.0, 3],
          ['Dan',    110000.0, 4],
          ['Erin',   150000.0, 1],
          ['Greta',   95000.0, 2],
          ['Frank',   90000.0, 3],
          ['Helen',  100000.0, 1],
          ['Igor',    60000.0, 2],
        ],
      },
    ],
  },

  {
    slug: 'sql-running-total',
    title: 'Running Total of Likes',
    difficulty: 'HARD',
    category: 'sql',
    tags: 'window function,running total',
    description:
`For every post return:

* \`title\`,
* \`posted\` (date),
* \`running_total\` — the cumulative sum of \`likes\` over all posts up to and
  including this one (in chronological order, ties broken by post id).

Order by \`posted\`, \`id\` ascending.`,
    examples: [],
    constraints: '',
    hints: ['SUM(likes) OVER (ORDER BY posted, id)'],
    sqlSetup: BLOG_SCHEMA,
    starterCode: { sql: 'SELECT title, posted,\n       SUM(likes) OVER (ORDER BY posted, id) AS running_total\nFROM posts\nORDER BY posted, id;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['Hello world',  '2024-02-01',  20],
          ['Async Rust',   '2024-02-15', 115],
          ['My setup',     '2024-02-20', 120],
          ['Tasty pasta',  '2024-03-05', 160],
          ['Sourdough',    '2024-03-12', 190],
          ['New PR',       '2024-03-30', 202],
        ],
      },
    ],
  },

  {
    slug: 'sql-order-status-summary',
    title: 'Order Status Summary',
    difficulty: 'EASY',
    category: 'sql',
    tags: 'group by,aggregation',
    description:
`Return one row per order status with:

* \`status\`
* \`order_count\` — number of orders with that status
* \`total_amount\` — sum of \`total\` for that status

Order by \`status\` ascending.`,
    examples: [],
    constraints: '• Use GROUP BY status.',
    hints: ['COUNT(*) and SUM(total) can be computed in the same GROUP BY query.'],
    sqlSetup: SHOP_SCHEMA,
    starterCode: { sql: 'SELECT status, COUNT(*) AS order_count, SUM(total) AS total_amount\nFROM orders\nGROUP BY status\nORDER BY status;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['CANCELLED', 1,   25.5],
          ['PAID',      6, 1595.0],
          ['REFUNDED',  1,   75.0],
        ],
      },
    ],
  },

  {
    slug: 'sql-post-author-stats',
    title: 'Post Stats Per Author',
    difficulty: 'MEDIUM',
    category: 'sql',
    tags: 'left join,group by,coalesce',
    description:
`Return every user with their posting stats:

* \`username\`
* \`post_count\`
* \`total_likes\`

Users with no posts must still appear with \`0\` posts and \`0\` likes.
Order by \`username\` ascending.`,
    examples: [],
    constraints: '• Use a LEFT JOIN from users to posts.',
    hints: ['COUNT(posts.id) ignores NULL rows.', 'COALESCE(SUM(likes), 0) handles users without posts.'],
    sqlSetup: BLOG_SCHEMA,
    starterCode: { sql: 'SELECT u.username,\n       COUNT(p.id) AS post_count,\n       COALESCE(SUM(p.likes), 0) AS total_likes\nFROM users u\nLEFT JOIN posts p ON\nGROUP BY u.id\nORDER BY u.username;\n' },
    testCases: [
      {
        ordered: true,
        expected: [
          ['alice', 2, 115],
          ['bob',   1,   5],
          ['carol', 2,  70],
          ['dan',   1,  12],
          ['erin',  0,   0],
        ],
      },
    ],
  },
];
