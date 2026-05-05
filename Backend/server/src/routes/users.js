import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, optionalAuth, hashPassword, verifyPassword, publicUser, revokeAllForUser } from '../auth.js';

const router = Router();

const UpdateProfileSchema = z.object({
  fullName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(80).optional(),
  website: z.string().url().or(z.literal('')).optional(),
  avatarUrl: z.string().url().or(z.literal('')).optional(),
  theme: z.enum(['dark', 'light']).optional(),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});

router.get('/stats', (_req, res) => {
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(DISTINCT user_id) FROM submissions WHERE status = 'ACCEPTED') AS active_solvers
  `).get();

  res.json({
    totalUsers: stats.total_users,
    activeSolvers: stats.active_solvers,
  });
});

router.get('/leaderboard', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.full_name, u.avatar_url, u.rating, u.created_at,
      (SELECT COUNT(DISTINCT s.problem_id) FROM submissions s WHERE s.user_id = u.id AND s.status = 'ACCEPTED') AS solved
    FROM users u
    ORDER BY u.rating DESC, solved DESC, u.id ASC
    LIMIT 100
  `).all();
  res.json(rows.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    username: r.username,
    fullName: r.full_name,
    avatarUrl: r.avatar_url,
    rating: r.rating,
    solved: r.solved,
    createdAt: r.created_at,
  })));
});

router.get('/profile/:username', optionalAuth, (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE username = ?`).get(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted
    FROM submissions WHERE user_id = ?
  `).get(u.id);

  const solvedByDifficulty = db.prepare(`
    SELECT p.difficulty, COUNT(DISTINCT s.problem_id) AS solved
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.status = 'ACCEPTED'
    GROUP BY p.difficulty
  `).all(u.id);

  const totalsByDifficulty = db.prepare(`
    SELECT difficulty, COUNT(*) AS n FROM problems GROUP BY difficulty
  `).all();

  const recent = db.prepare(`
    SELECT s.id, s.status, s.created_at, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC LIMIT 10
  `).all(u.id);

  const calendar = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS n
    FROM submissions
    WHERE user_id = ? AND date(created_at) >= date('now', '-180 days')
    GROUP BY day ORDER BY day ASC
  `).all(u.id);

  res.json({
    user: publicUser(u),
    stats: {
      totalSubmissions: totals?.total || 0,
      accepted: totals?.accepted || 0,
      acceptanceRate: totals?.total ? +(totals.accepted / totals.total * 100).toFixed(1) : 0,
      solvedByDifficulty: ['EASY', 'MEDIUM', 'HARD'].map(d => ({
        difficulty: d,
        solved: (solvedByDifficulty.find(r => r.difficulty === d)?.solved) || 0,
        total: (totalsByDifficulty.find(r => r.difficulty === d)?.n) || 0,
      })),
    },
    recentSubmissions: recent.map(r => ({
      id: r.id, status: r.status, createdAt: r.created_at,
      problem: { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty },
    })),
    calendar,
  });
});

router.get('/me/dashboard', requireAuth, (req, res) => {
  const userId = req.user.id;
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted
    FROM submissions WHERE user_id = ?
  `).get(userId);

  const solvedByDifficulty = db.prepare(`
    SELECT p.difficulty, COUNT(DISTINCT s.problem_id) AS solved
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.status = 'ACCEPTED'
    GROUP BY p.difficulty
  `).all(userId);

  const totalsByDifficulty = db.prepare(`
    SELECT difficulty, COUNT(*) AS n FROM problems GROUP BY difficulty
  `).all();

  const recent = db.prepare(`
    SELECT s.id, s.status, s.created_at, s.runtime_ms, s.memory_kb, s.language,
           p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC LIMIT 8
  `).all(userId);

  const recommended = db.prepare(`
    SELECT p.id, p.slug, p.title, p.difficulty, p.tags
    FROM problems p
    WHERE p.id NOT IN (
      SELECT problem_id FROM submissions WHERE user_id = ? AND status = 'ACCEPTED'
    )
    ORDER BY p.id ASC
    LIMIT 5
  `).all(userId);

  // streak: consecutive days with at least 1 ACCEPTED submission, ending today
  const days = db.prepare(`
    SELECT DISTINCT date(created_at) AS day
    FROM submissions
    WHERE user_id = ? AND status = 'ACCEPTED'
    ORDER BY day DESC
  `).all(userId).map(r => r.day);

  let streak = 0;
  if (days.length) {
    const today = new Date(); today.setHours(0,0,0,0);
    const ymd = (d) => d.toISOString().slice(0, 10);
    let cursor = ymd(today);
    if (days[0] !== cursor) {
      const yesterday = new Date(today.getTime() - 86400000);
      if (days[0] === ymd(yesterday)) cursor = ymd(yesterday);
    }
    for (const d of days) {
      if (d === cursor) {
        streak += 1;
        const next = new Date(cursor); next.setDate(next.getDate() - 1);
        cursor = ymd(next);
      } else if (new Date(d) < new Date(cursor)) {
        break;
      }
    }
  }

  res.json({
    totals: {
      submissions: totals?.total || 0,
      accepted: totals?.accepted || 0,
      acceptanceRate: totals?.total ? +(totals.accepted / totals.total * 100).toFixed(1) : 0,
      streak,
      rating: req.user.rating,
    },
    solvedByDifficulty: ['EASY', 'MEDIUM', 'HARD'].map(d => ({
      difficulty: d,
      solved: (solvedByDifficulty.find(r => r.difficulty === d)?.solved) || 0,
      total: (totalsByDifficulty.find(r => r.difficulty === d)?.n) || 0,
    })),
    recentSubmissions: recent.map(r => ({
      id: r.id, status: r.status, createdAt: r.created_at, language: r.language,
      runtimeMs: r.runtime_ms, memoryKb: r.memory_kb,
      problem: { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty },
    })),
    recommended: recommended.map(r => ({
      id: r.id, slug: r.slug, title: r.title, difficulty: r.difficulty,
      tags: r.tags ? r.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
    })),
  });
});

router.get('/me/favorites', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.slug, p.title, p.difficulty, p.tags, c.slug as category_slug, c.name as category_name
    FROM favorites f
    JOIN problems p ON p.id = f.problem_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(req.user.id);
  res.json(rows.map(r => ({
    id: r.id, slug: r.slug, title: r.title, difficulty: r.difficulty,
    tags: r.tags ? r.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
    category: r.category_slug ? { slug: r.category_slug, name: r.category_name } : null,
  })));
});

router.patch('/me', requireAuth, (req, res) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const fields = parsed.data;
  const map = {
    fullName: 'full_name',
    avatarUrl: 'avatar_url',
    bio: 'bio',
    location: 'location',
    website: 'website',
    theme: 'theme',
  };
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    sets.push(`${map[k]} = ?`);
    args.push(v === '' ? null : v);
  }
  if (!sets.length) return res.json(publicUser(req.user));
  sets.push(`updated_at = datetime('now')`);
  args.push(req.user.id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  res.json(publicUser(u));
});

router.post('/me/password', requireAuth, (req, res) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!req.user.password_hash) {
    return res.status(400).json({ error: 'This account uses Google OAuth and has no password set.' });
  }
  if (!verifyPassword(parsed.data.currentPassword, req.user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(hashPassword(parsed.data.newPassword), req.user.id);
  revokeAllForUser(req.user.id);
  res.json({ ok: true });
});

export default router;
