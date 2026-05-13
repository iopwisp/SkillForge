/**
 * Validate SQL problems with reference solutions.
 */
import { runSqlJudge } from '../src/modules/judge/service.js';
import { SQL_PROBLEMS } from '../src/shared/seed/sql.js';

const REF = {
  'sql-select-all-customers':
    'SELECT id, name, country, created FROM customers',
  'sql-customers-from-us':
    "SELECT id, name FROM customers WHERE country = 'US' ORDER BY id",
  'sql-distinct-countries':
    'SELECT DISTINCT country FROM customers',
  'sql-products-by-price':
    'SELECT name, price FROM products ORDER BY price DESC LIMIT 3',
  'sql-customers-per-country':
    'SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country',
  'sql-orders-with-customer-names':
    `SELECT o.id AS order_id, c.name AS customer_name, o.total
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.status = 'PAID' ORDER BY o.id`,
  'sql-customers-without-orders':
    `SELECT c.id, c.name FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id
     WHERE o.id IS NULL ORDER BY c.id`,
  'sql-top-spenders':
    `SELECT c.name, SUM(o.total) AS total_spent
     FROM customers c JOIN orders o ON o.customer_id = c.id
     WHERE o.status = 'PAID' GROUP BY c.id
     HAVING total_spent > 200 ORDER BY total_spent DESC`,
  'sql-out-of-stock':
    'SELECT id, name FROM products WHERE stock = 0 ORDER BY id',
  'sql-product-revenue':
    `SELECT p.name, SUM(oi.qty * p.price) AS revenue
     FROM products p JOIN order_items oi ON oi.product_id = p.id
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'PAID' GROUP BY p.id
     HAVING revenue > 0 ORDER BY revenue DESC`,
  'sql-employee-manager':
    `SELECT e.name AS employee, m.name AS manager
     FROM employees e LEFT JOIN employees m ON m.id = e.manager_id
     ORDER BY e.name`,
  'sql-second-highest-salary':
    `WITH ranked AS (
       SELECT e.*, ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC) rn
       FROM employees e
     )
     SELECT d.name AS department, r.name AS employee, r.salary
     FROM ranked r JOIN departments d ON d.id = r.department_id
     WHERE r.rn = 2`,
  'sql-rank-by-salary':
    `SELECT name, salary,
       RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS dept_rank
     FROM employees ORDER BY department_id, dept_rank`,
  'sql-running-total':
    `SELECT title, posted, SUM(likes) OVER (ORDER BY posted, id) AS running_total
     FROM posts ORDER BY posted, id`,
  'sql-order-status-summary':
    `SELECT status, COUNT(*) AS order_count, SUM(total) AS total_amount
     FROM orders GROUP BY status ORDER BY status`,
  'sql-post-author-stats':
    `SELECT u.username,
       COUNT(p.id) AS post_count,
       COALESCE(SUM(p.likes), 0) AS total_likes
     FROM users u LEFT JOIN posts p ON p.user_id = u.id
     GROUP BY u.id ORDER BY u.username`,
};

let okCount = 0, failCount = 0;
const failures = [];
for (const p of SQL_PROBLEMS) {
  const sol = REF[p.slug];
  if (!sol) {
    console.log(`  ?? ${p.slug} (no reference)`);
    failCount++; failures.push(p.slug); continue;
  }
  const res = runSqlJudge({
    sql_setup: p.sqlSetup,
    test_cases_json: JSON.stringify(p.testCases),
    time_limit_ms: 2000,
  }, sol);
  if (res.status === 'ACCEPTED') {
    console.log(`  ok  ${p.slug}: ${res.testsPassed}/${res.testsTotal}`);
    okCount++;
  } else {
    console.log(`  FAIL ${p.slug}: ${res.status} (${res.testsPassed}/${res.testsTotal})`);
    console.log('       ' + (res.output || res.error || '').replaceAll('\n','\n       '));
    failCount++; failures.push(p.slug);
  }
}
console.log(`\n${okCount} accepted, ${failCount} failed.`);
if (failures.length) console.log('Failures:', failures.join(', '));
process.exit(failCount === 0 ? 0 : 1);
