/**
 * HTTP routes for /api/auth/*. Thin layer over the auth service.
 */
import { Router } from 'express';

import { asyncHandler, fromZod } from '../../shared/errors.js';
import { requireAuth } from './middleware.js';
import { LoginSchema, RegisterSchema } from './schemas.js';
import * as auth from './service.js';

const router = Router();

router.post('/register', (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(auth.register(parsed.data));
});

router.post('/login', (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(auth.login(parsed.data));
});

router.post('/refresh', (req, res) => {
  res.json(auth.refresh(req.body?.refreshToken));
});

router.post('/logout', (req, res) => {
  auth.logout(req.body?.refreshToken);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(auth.publicUser(req.user));
});

/* ── Google OAuth ───────────────────────────────────────────────────────── */

router.get('/google', (req, res) => {
  res.redirect(auth.buildGoogleAuthUrl(req.query.next));
});

router.get('/google/url', (req, res) => {
  res.json({ url: auth.buildGoogleAuthUrl(req.query.next) });
});

router.get('/google/callback', asyncHandler(async (req, res) => {
  const result = await auth.completeGoogleRedirect({
    code: req.query.code,
    state: req.query.state,
  });
  if (result.error) return redirectWithError(res, result.frontend, result.error);
  const url = new URL(result.frontend);
  url.searchParams.set('accessToken', result.auth.accessToken);
  url.searchParams.set('refreshToken', result.auth.refreshToken);
  res.redirect(url.toString());
}));

router.post('/google/exchange', asyncHandler(async (req, res) => {
  res.json(await auth.exchangeGoogleCode(req.body?.code));
}));

function redirectWithError(res, frontend, code) {
  const url = new URL(frontend);
  url.searchParams.set('error', code);
  res.redirect(url.toString());
}

export default router;
