import { db } from '../../shared/db.js';

export const listCategoriesWithCounts = () =>
  db.prepare(`
    SELECT c.id, c.slug, c.name, c.description, c.icon, c.color,
      (SELECT COUNT(*) FROM problems p WHERE p.category_id = c.id) AS problem_count
    FROM categories c
    ORDER BY c.name ASC
  `).all();
