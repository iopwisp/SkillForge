/**
 * HTTP routes for /api/categories/*.
 */
import { Router } from 'express';

import { asyncHandler } from '../../shared/errors.js';
import * as categories from './service.js';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  res.json(await categories.list());
}));

export default router;
