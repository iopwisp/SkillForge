import { Router } from 'express';
import { db } from '../db.js';
import { optionalAuth, requireAuth } from '../auth.js';

const router = Router();

router.get('/', optionalAuth, (req, res) => {
  const { search, difficulty, category, status, page = '1', pageSize = '50', tag, type } = req.query;
  const offset = (Math.max(parseInt(page, 10), 1) - 1) * parseInt(pageSize, 10);
  const limit = Math.min(parseInt(pageSize, 10), 200);

  const where = [];
  const args = [];
  if (search) {
    where.push('(p.title LIKE ? OR p.tags LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  if (difficulty && ['EASY', 'MEDIUM', 'HARD'].includes(String(difficulty).toUpperCase())) {
    where.push('p.difficulty = ?');
    args.push(String(difficulty).toUpperCase());
  }
  if (type && ['ALGORITHM', 'SQL', 'BACKEND', 'FRONTEND'].includes(String(type).toUpperCase())) {
    where.push('p.problem_type = ?');
    args.push(String(type).toUpperCase());
  }
  if (category) {
    where.push('c.slug = ?');
    args.push(String(category));
  }
  if (tag) {
    where.push('p.tags LIKE ?');
    args.push(`%${tag}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = db.prepare(`
    SELECT COUNT(*) as n
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}
  `).get(...args);

  const userId = req.user?.id || 0;

  const rows = db.prepare(`
    SELECT
      p.id, p.slug, p.title, p.difficulty, p.problem_type, p.tags, p.is_premium,
      p.total_submissions, p.accepted_submissions, p.created_at,
      c.slug as category_slug, c.name as category_name,
      EXISTS(SELECT 1 FROM submissions s WHERE s.user_id = ? AND s.problem_id = p.id AND s.status = 'ACCEPTED') as solved,
      EXISTS(SELECT 1 FROM submissions s WHERE s.user_id = ? AND s.problem_id = p.id) as attempted,
      EXISTS(SELECT 1 FROM favorites f WHERE f.user_id = ? AND f.problem_id = p.id) as favorited
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}
    ORDER BY p.id ASC
    LIMIT ? OFFSET ?
  `).all(userId, userId, userId, ...args, limit, offset);

  const items = rows.map(toProblemSummary).filter(p => {
    if (status === 'solved') return p.status === 'solved';
    if (status === 'attempted') return p.status === 'attempted';
    if (status === 'todo') return p.status === null;
    return true;
  });

  res.json({
    items,
    total: totalRow.n,
    page: parseInt(page, 10),
    pageSize: limit,
  });
});

router.get('/:slug', optionalAuth, (req, res) => {
  const userId = req.user?.id || 0;
  const p = db.prepare(`
    SELECT p.*, c.slug as category_slug, c.name as category_name
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ?
  `).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Problem not found' });

  const solved = !!db.prepare(`SELECT 1 FROM submissions WHERE user_id = ? AND problem_id = ? AND status = 'ACCEPTED'`).get(userId, p.id);
  const attempted = !!db.prepare(`SELECT 1 FROM submissions WHERE user_id = ? AND problem_id = ?`).get(userId, p.id);
  const favorited = !!db.prepare(`SELECT 1 FROM favorites WHERE user_id = ? AND problem_id = ?`).get(userId, p.id);

  res.json({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    problemType: p.problem_type || 'ALGORITHM',
    category: p.category_slug ? { slug: p.category_slug, name: p.category_name } : null,
    tags: p.tags ? p.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
    examples: safeJson(p.examples_json, []),
    constraints: p.constraints || '',
    hints: safeJson(p.hints_json, []),
    starterCode: safeJson(p.starter_code_json, {}),
    sqlSetup: p.sql_setup || null,
    functionName: p.function_name || null,
    timeLimitMs: p.time_limit_ms,
    memoryLimitMb: p.memory_limit_mb,
    isPremium: !!p.is_premium,
    totalSubmissions: p.total_submissions,
    acceptedSubmissions: p.accepted_submissions,
    acceptanceRate: p.total_submissions ? +(p.accepted_submissions / p.total_submissions * 100).toFixed(1) : 0,
    status: solved ? 'solved' : attempted ? 'attempted' : null,
    favorited,
  });
});

router.post('/:slug/favorite', requireAuth, (req, res) => {
  const p = db.prepare(`SELECT id FROM problems WHERE slug = ?`).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Problem not found' });
  const exists = db.prepare(`SELECT 1 FROM favorites WHERE user_id = ? AND problem_id = ?`).get(req.user.id, p.id);
  if (exists) {
    db.prepare(`DELETE FROM favorites WHERE user_id = ? AND problem_id = ?`).run(req.user.id, p.id);
    return res.json({ favorited: false });
  }
  db.prepare(`INSERT INTO favorites (user_id, problem_id) VALUES (?, ?)`).run(req.user.id, p.id);
  res.json({ favorited: true });
});

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function toProblemSummary(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    problemType: r.problem_type || 'ALGORITHM',
    tags: r.tags ? r.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
    category: r.category_slug ? { slug: r.category_slug, name: r.category_name } : null,
    isPremium: !!r.is_premium,
    totalSubmissions: r.total_submissions,
    acceptedSubmissions: r.accepted_submissions,
    acceptanceRate: r.total_submissions ? +(r.accepted_submissions / r.total_submissions * 100).toFixed(1) : 0,
    status: r.solved ? 'solved' : r.attempted ? 'attempted' : null,
    favorited: !!r.favorited,
  };
}

export default router;
