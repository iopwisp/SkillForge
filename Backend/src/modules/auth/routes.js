/**
 * HTTP routes for /api/auth/*. Thin layer over the auth service.
 *
 * Backward-compatible URLs (the SPA depends on these):
 *   POST /register, /login, /refresh, /logout
 *   GET  /me
 *   GET  /google, /google/url, /google/callback
 *   POST /google/exchange
 *
 * New:
 *   GET  /providers                         — list registered providers
 *   GET  /oauth/:provider, /url, /callback  — generic OAuth routes
 *   POST /oauth/:provider/exchange          — generic SPA exchange
 *
 * The /google/* routes stay because they are registered with Google's
 * OAuth console as the redirect URI; the new /oauth/:provider/* shape
 * is what we will register with Microsoft / generic OIDC providers
 * starting in Phase 2.
 */
import { Router } from 'express';

import { asyncHandler, fromZod } from '../../shared/errors.js';
import { requireAuth } from './middleware.js';
import { LoginSchema, RegisterSchema } from './schemas.js';
import * as auth from './service.js';

const router = Router();

/* ── local (password) routes ────────────────────────────────────────────── */

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

/* ── provider discovery ─────────────────────────────────────────────────── */

router.get('/providers', (_req, res) => {
  res.json(auth.getProviderList());
});

/* ── google (kept for backward compatibility with the SPA + Google console) ─ */

router.get('/google', (req, res) => {
  res.redirect(auth.buildOAuthAuthUrl('google', { next: req.query.next }));
});

router.get('/google/url', (req, res) => {
  res.json({ url: auth.buildOAuthAuthUrl('google', { next: req.query.next }) });
});

router.get('/google/callback', asyncHandler(async (req, res) => {
  await handleOAuthCallback('google', req, res);
}));

router.post('/google/exchange', asyncHandler(async (req, res) => {
  res.json(await auth.exchangeOAuthCode('google', req.body?.code));
}));

/* ── generic OAuth routes (Microsoft 365 / OIDC will use these) ─────────── */

router.get('/oauth/:provider', (req, res) => {
  res.redirect(auth.buildOAuthAuthUrl(req.params.provider, { next: req.query.next }));
});

router.get('/oauth/:provider/url', (req, res) => {
  res.json({ url: auth.buildOAuthAuthUrl(req.params.provider, { next: req.query.next }) });
});

router.get('/oauth/:provider/callback', asyncHandler(async (req, res) => {
  await handleOAuthCallback(req.params.provider, req, res);
}));

router.post('/oauth/:provider/exchange', asyncHandler(async (req, res) => {
  res.json(await auth.exchangeOAuthCode(req.params.provider, req.body?.code));
}));

/* ── shared helpers ─────────────────────────────────────────────────────── */

async function handleOAuthCallback(providerName, req, res) {
  const result = await auth.completeOAuthRedirect(providerName, {
    code: req.query.code,
    state: req.query.state,
  });
  if (result.error) return redirectWithError(res, result.frontend, result.error);
  const url = new URL(result.frontend);
  url.searchParams.set('accessToken', result.auth.accessToken);
  url.searchParams.set('refreshToken', result.auth.refreshToken);
  res.redirect(url.toString());
}

function redirectWithError(res, frontend, code) {
  const url = new URL(frontend);
  url.searchParams.set('error', code);
  res.redirect(url.toString());
}

export default router;
