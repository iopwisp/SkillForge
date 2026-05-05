import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.slug, c.name, c.description, c.icon, c.color,
      (SELECT COUNT(*) FROM problems p WHERE p.category_id = c.id) AS problem_count
    FROM categories c
    ORDER BY c.name ASC
  `).all();
  res.json(rows);
});

export default router;
