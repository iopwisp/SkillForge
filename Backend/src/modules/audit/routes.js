import { Router } from 'express';

import { asyncHandler } from '../../shared/errors.js';
import { requireRole, ROLES } from '../auth/middleware.js';
import * as audit from './service.js';

const router = Router();

router.get('/', requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  res.json(await audit.listEvents(req.query));
}));

export default router;
