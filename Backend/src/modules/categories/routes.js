/**
 * HTTP routes for /api/categories/*.
 */
import { Router } from 'express';

import * as categories from './service.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(categories.list());
});

export default router;
