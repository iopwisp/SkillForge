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

const isProd = process.env.NODE_ENV === 'production';
const sameSiteOption = process.env.COOKIE_SAMESITE || 'lax';
const cookieOptions = {
  httpOnly: true,
  secure: isProd || sameSiteOption === 'none',
  sameSite: sameSiteOption,
  path: '/',
};

function setAuthCookies(res, authData) {
  res.cookie('accessToken', authData.accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 }); // 15 min
  res.cookie('refreshToken', authData.refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 }); // 7 days
}

function clearAuthCookies(res) {
  res.clearCookie('accessToken', cookieOptions);
  res.clearCookie('refreshToken', cookieOptions);
}

const router = Router();

/* ── local (password) routes ────────────────────────────────────────────── */

router.post('/register', asyncHandler(async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const result = await auth.register(parsed.data);
  setAuthCookies(res, result);
  res.status(201).json(result);
}));

router.post('/login', asyncHandler(async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const result = await auth.login(parsed.data);
  setAuthCookies(res, result);
  res.json(result);
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.refreshToken;
  const result = await auth.refresh(token);
  setAuthCookies(res, result);
  res.json(result);
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.refreshToken;
  await auth.logout(token);
  clearAuthCookies(res);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json(auth.publicUser(req.user));
});

/* ── provider discovery ─────────────────────────────────────────────────── */

router.get('/providers', (_req, res) => {
  res.json(auth.getProviderList());
});

/* ── google (kept for backward compatibility with the SPA + Google console) ─ */

router.get('/google', asyncHandler(async (req, res) => {
  res.redirect(await auth.buildOAuthAuthUrl('google', { next: req.query.next }));
}));

router.get('/google/url', asyncHandler(async (req, res) => {
  res.json({ url: await auth.buildOAuthAuthUrl('google', { next: req.query.next }) });
}));

router.get('/google/callback', asyncHandler(async (req, res) => {
  await handleOAuthCallback('google', req, res);
}));

router.post('/google/exchange', asyncHandler(async (req, res) => {
  res.json(await auth.exchangeOAuthCode('google', req.body?.code));
}));

/* ── generic OAuth routes (Microsoft 365 / OIDC will use these) ─────────── */

router.get('/oauth/:provider', asyncHandler(async (req, res) => {
  res.redirect(await auth.buildOAuthAuthUrl(req.params.provider, { next: req.query.next }));
}));

router.get('/oauth/:provider/url', asyncHandler(async (req, res) => {
  res.json({ url: await auth.buildOAuthAuthUrl(req.params.provider, { next: req.query.next }) });
}));

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
  setAuthCookies(res, result.auth);
  const url = new URL(result.frontend);
  // Still appending to URL for backward compatibility if the SPA reads them
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
