import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db } from '../db.js';
import {
  hashPassword, verifyPassword, buildAuthResponse, rotateRefreshToken,
  revokeRefreshToken, requireAuth, publicUser,
} from '../auth.js';

const router = Router();
const DEFAULT_GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/auth/google/callback';
const DEFAULT_GOOGLE_FRONTEND_REDIRECT = 'http://localhost:5173/auth/callback';

const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'letters, digits, _ or - only'),
  email: z.string().email(),
  password: z.string().min(6).max(128),
  fullName: z.string().min(1).max(80).optional(),
});

const LoginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

router.post('/register', (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { username, email, password, fullName } = parsed.data;

  const exists = db.prepare(`SELECT id FROM users WHERE username = ? OR email = ?`).get(username, email);
  if (exists) return res.status(409).json({ error: 'Username or email already taken' });

  const hash = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO users (username, email, password_hash, full_name, avatar_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, email, hash, fullName || username, defaultAvatar(username));

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
  return res.status(201).json(buildAuthResponse(user));
});

router.post('/login', (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { emailOrUsername, password } = parsed.data;

  const user = db.prepare(`
    SELECT * FROM users WHERE email = ? OR username = ?
  `).get(emailOrUsername, emailOrUsername);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  return res.json(buildAuthResponse(user));
});

router.post('/refresh', (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });
  const result = rotateRefreshToken(refreshToken);
  if (!result) return res.status(401).json({ error: 'Invalid or expired refresh token' });
  const access = buildAuthResponse(result.user);
  // we already issued a new refresh inside rotate, swap it in
  return res.json({ ...access, refreshToken: result.newRefresh });
});

router.post('/logout', (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (refreshToken) revokeRefreshToken(refreshToken);
  return res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

/* ───────────── Google OAuth ─────────────
 * /google                 → redirect to Google's consent screen
 * /google/url             → return the Google consent URL for the SPA
 * /google/callback?code=… → exchange code for tokens, upsert user, redirect to frontend with tokens
 * /google/exchange        → POST {code} from a SPA flow (alternative to redirect handoff)
 */
router.get('/google', (req, res) => {
  return res.redirect(buildGoogleAuthUrl(req.query.next));
});

router.get('/google/url', (req, res) => {
  return res.json({ url: buildGoogleAuthUrl(req.query.next) });
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const defaultFrontend = process.env.GOOGLE_FRONTEND_REDIRECT || DEFAULT_GOOGLE_FRONTEND_REDIRECT;

  if (!code) return redirectWithError(res, defaultFrontend, 'missing_code');
  const stateRow = db.prepare(`SELECT * FROM oauth_states WHERE state = ?`).get(state);
  if (!stateRow) return redirectWithError(res, defaultFrontend, 'invalid_state');
  db.prepare(`DELETE FROM oauth_states WHERE state = ?`).run(state);

  const frontend = buildFrontendRedirect(defaultFrontend, stateRow.redirect);

  try {
    const auth = await loginOrCreateWithGoogle(String(code));
    const url = new URL(frontend);
    url.searchParams.set('accessToken', auth.accessToken);
    url.searchParams.set('refreshToken', auth.refreshToken);
    return res.redirect(url.toString());
  } catch (e) {
    console.error('Google OAuth failed:', e);
    return redirectWithError(res, frontend, 'oauth_failed');
  }
});

router.post('/google/exchange', async (req, res) => {
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: 'code is required' });
  try {
    const auth = await loginOrCreateWithGoogle(code);
    return res.json(auth);
  } catch (e) {
    console.error('Google OAuth failed:', e);
    return res.status(400).json({ error: 'OAuth exchange failed' });
  }
});

function redirectWithError(res, frontend, code) {
  const url = new URL(frontend);
  url.searchParams.set('error', code);
  res.redirect(url.toString());
}

async function loginOrCreateWithGoogle(code) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || DEFAULT_GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error('token exchange failed: ' + tokenRes.status);
  const tokens = await tokenRes.json();

  const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) throw new Error('userinfo failed');
  const profile = await meRes.json();
  // profile: { sub, email, email_verified, name, given_name, family_name, picture, ... }

  const sub = String(profile.sub);
  const email = profile.email;
  const name = profile.name || profile.given_name || email.split('@')[0];
  const avatar = profile.picture || null;

  let user = db.prepare(`SELECT * FROM users WHERE google_id = ?`).get(sub);
  if (!user && email) user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

  if (user) {
    db.prepare(`
      UPDATE users SET google_id = ?, avatar_url = COALESCE(avatar_url, ?), full_name = COALESCE(full_name, ?), updated_at = datetime('now') WHERE id = ?
    `).run(sub, avatar, name, user.id);
  } else {
    const baseUsername = (profile.given_name || email.split('@')[0] || 'user')
      .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'user';
    let username = baseUsername;
    let n = 0;
    while (db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)) {
      n += 1;
      username = `${baseUsername}${n}`;
    }
    const info = db.prepare(`
      INSERT INTO users (username, email, google_id, avatar_url, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, email, sub, avatar, name);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
  }
  return buildAuthResponse(db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id));
}

function buildGoogleAuthUrl(next) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const error = new Error('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Backend/.env');
    error.status = 503;
    throw error;
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || DEFAULT_GOOGLE_REDIRECT_URI;
  const state = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO oauth_states (state, redirect) VALUES (?, ?)`).run(state, normalizeNext(next));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function buildFrontendRedirect(frontend, next) {
  const url = new URL(frontend);
  const safeNext = normalizeNext(next);
  if (safeNext) {
    url.searchParams.set('next', safeNext);
  }
  return url.toString();
}

function normalizeNext(next) {
  if (typeof next !== 'string') return '';
  if (!next.startsWith('/') || next.startsWith('//')) return '';
  return next;
}

function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

export default router;
