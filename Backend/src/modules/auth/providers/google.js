/**
 * Google OAuth 2.0 provider.
 *
 * Three entry points (matching the existing /api/auth/google/* routes
 * the frontend depends on):
 *
 *   buildAuthUrl({ next })
 *     → string
 *     Generate the redirect URL to Google's consent screen. Stores a
 *     server-side `state` for CSRF protection.
 *
 *   completeAuth({ code, state })
 *     → { user, frontend } | { error, frontend }
 *     Handler for the redirect callback. Validates state, exchanges
 *     the code for tokens, fetches the userinfo, upserts the user.
 *     Returns the frontend redirect URL even on error so the SPA can
 *     show a sensible message via `?error=` query param.
 *
 *   exchangeCode(code)
 *     → user
 *     Used by the alternative SPA-side flow (`POST /google/exchange`).
 *     No state validation — the caller is the SPA, which already
 *     completed the redirect itself.
 *
 * For Microsoft 365 / generic OIDC later, this whole file becomes the
 * template — same shape, different endpoints + audience, different
 * userinfo schema.
 */
import crypto from 'node:crypto';

import { HttpError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';
import * as q from '../queries.js';

const DEFAULT_REDIRECT_URI = 'http://localhost:4000/api/auth/google/callback';
const DEFAULT_FRONTEND_REDIRECT = 'http://localhost:5173/auth/callback';

export const googleProvider = {
  name: 'google',
  type: 'oauth2',

  /**
   * Available iff the deployment configured both `GOOGLE_CLIENT_ID` and
   * `GOOGLE_CLIENT_SECRET`. We re-check on every call rather than caching,
   * so a deploy that adds the env vars + restarts picks them up.
   */
  enabled() {
    return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  },

  buildAuthUrl({ next } = {}) {
    if (!this.enabled()) {
      throw new HttpError(503, 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Backend/.env');
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT_URI;
    const state = crypto.randomBytes(16).toString('hex');
    q.insertOAuthState({ state, redirect: normalizeNext(next) });

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
  },

  async completeAuth({ code, state } = {}) {
    const defaultFrontend = process.env.GOOGLE_FRONTEND_REDIRECT || DEFAULT_FRONTEND_REDIRECT;
    if (!code) return { error: 'missing_code', frontend: defaultFrontend };

    const stateRow = q.findOAuthState(state);
    if (!stateRow) return { error: 'invalid_state', frontend: defaultFrontend };
    q.deleteOAuthState(state);

    const frontend = buildFrontendRedirect(defaultFrontend, stateRow.redirect);
    try {
      const user = await loginOrCreateWithGoogle(String(code));
      return { user, frontend };
    } catch (e) {
      logger.error({ err: e }, 'Google OAuth callback failed');
      return { error: 'oauth_failed', frontend };
    }
  },

  async exchangeCode(code) {
    if (!code) throw new HttpError(400, 'code is required');
    try {
      return await loginOrCreateWithGoogle(code);
    } catch (e) {
      logger.error({ err: e }, 'Google OAuth code exchange failed');
      throw new HttpError(400, 'OAuth exchange failed');
    }
  },
};

/* ─── internals ─────────────────────────────────────────────────────────── */

async function loginOrCreateWithGoogle(code) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error('token exchange failed: ' + tokenRes.status);
  const tokens = await tokenRes.json();

  const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) throw new Error('userinfo failed');
  const profile = await meRes.json();

  const sub = String(profile.sub);
  const email = profile.email;
  const name = profile.name || profile.given_name || email.split('@')[0];
  const avatar = profile.picture || null;

  let user = q.findUserByGoogleId(sub);
  if (!user && email) user = q.findUserByEmail(email);

  if (user) {
    q.linkGoogleToUser(user.id, { googleId: sub, avatarUrl: avatar, fullName: name });
  } else {
    const baseUsername = (profile.given_name || email.split('@')[0] || 'user')
      .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'user';
    let username = baseUsername;
    let n = 0;
    while (q.findUserByUsername(username)) {
      n += 1;
      username = `${baseUsername}${n}`;
    }
    user = q.insertGoogleUser({ username, email, googleId: sub, avatarUrl: avatar, fullName: name });
  }
  return q.findUserById(user.id);
}

function buildFrontendRedirect(frontend, next) {
  const url = new URL(frontend);
  const safeNext = normalizeNext(next);
  if (safeNext) url.searchParams.set('next', safeNext);
  return url.toString();
}

function normalizeNext(next) {
  if (typeof next !== 'string') return '';
  if (!next.startsWith('/') || next.startsWith('//')) return '';
  return next;
}
