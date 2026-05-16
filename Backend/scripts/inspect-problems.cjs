const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const r = await c.query(`
    SELECT slug, problem_type,
      (test_cases_json IS NULL OR test_cases_json = '') AS no_tests
    FROM problems
    ORDER BY problem_type, slug
  `);
  let totalAlgo = 0, algoNoTests = 0;
  for (const row of r.rows) {
    if (row.problem_type === 'ALGORITHM') {
      totalAlgo++;
      if (row.no_tests) algoNoTests++;
    }
    if (row.no_tests) console.log(row.problem_type, row.slug, 'NO TESTS');
  }
  console.log('---');
  console.log(`ALGORITHM: ${algoNoTests}/${totalAlgo} without tests`);
  await c.end();
})();
