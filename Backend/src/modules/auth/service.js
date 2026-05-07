/**
 * Auth service — business logic for authentication.
 *
 * Owns:
 *   - password hashing / verification
 *   - JWT issuance / verification (access + refresh)
 *   - register / login / refresh-rotation / logout flows
 *   - Google OAuth login + first-time account creation
 *   - public-facing user serialization (`publicUser`)
 *
 * The HTTP layer (routes.js) is intentionally thin: it parses input, calls
 * one service function, and responds. All multi-step DB operations happen
 * here.
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

import { HttpError } from '../../shared/errors.js';
import * as q from './queries.js';

const JWT_SECRET = process.env.JWT_SECRET || 'skillforge-dev-secret-change-me';
const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TTL || '900', 10);     // 15 min
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TTL || '2592000', 10); // 30 days

const DEFAULT_GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/auth/google/callback';
const DEFAULT_GOOGLE_FRONTEND_REDIRECT = 'http://localhost:5173/auth/callback';

/* ─── password helpers ──────────────────────────────────────────────────── */

export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

/* ─── JWT helpers ───────────────────────────────────────────────────────── */

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

export function verifyAccessToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000).toISOString();
  q.insertRefreshToken({ userId, token, expiresAt });
  return token;
}

/* ─── user serialization ────────────────────────────────────────────────── */

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.full_name,
    avatarUrl: u.avatar_url,
    bio: u.bio,
    location: u.location,
    website: u.website,
    role: u.role,
    rating: u.rating,
    theme: u.theme,
    createdAt: u.created_at,
  };
}

export function buildAuthResponse(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: issueRefreshToken(user.id),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL,
    user: publicUser(user),
  };
}

/* ─── register / login / refresh / logout ───────────────────────────────── */

export function register({ username, email, password, fullName }) {
  if (q.findUserByUsernameOrEmailExact(username, email)) {
    throw new HttpError(409, 'Username or email already taken');
  }
  const user = q.insertLocalUser({
    username,
    email,
    passwordHash: hashPassword(password),
    fullName: fullName || username,
    avatarUrl: defaultAvatar(username),
  });
  return buildAuthResponse(user);
}

export function login({ emailOrUsername, password }) {
  const user = q.findUserByEmailOrUsername(emailOrUsername);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Invalid credentials');
  }
  return buildAuthResponse(user);
}

export function refresh(refreshToken) {
  if (!refreshToken) throw new HttpError(400, 'refreshToken is required');
  const row = q.findActiveRefreshToken(refreshToken);
  if (!row) throw new HttpError(401, 'Invalid or expired refresh token');
  if (new Date(row.expires_at) < new Date()) {
    throw new HttpError(401, 'Invalid or expired refresh token');
  }
  q.revokeRefreshTokenById(row.id);
  const user = q.findUserById(row.user_id);
  if (!user) throw new HttpError(401, 'Invalid or expired refresh token');
  return buildAuthResponse(user);
}

export function logout(refreshToken) {
  if (refreshToken) q.revokeRefreshTokenByValue(refreshToken);
}

/** Revoke all sessions, called when password changes. */
export function revokeAllForUser(userId) {
  q.revokeAllRefreshTokensForUser(userId);
}

/** Set a new password hash for a user. Used by users.service.changePassword. */
export function setPasswordHash(userId, hash) {
  q.updatePassword(userId, hash);
}

/* ─── Google OAuth ──────────────────────────────────────────────────────── */

export function buildGoogleAuthUrl(next) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new HttpError(503, 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Backend/.env');
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || DEFAULT_GOOGLE_REDIRECT_URI;
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
}

/** Used by the redirect callback. Returns { auth, frontend }. */
export async function completeGoogleRedirect({ code, state }) {
  const defaultFrontend = process.env.GOOGLE_FRONTEND_REDIRECT || DEFAULT_GOOGLE_FRONTEND_REDIRECT;
  if (!code) return { error: 'missing_code', frontend: defaultFrontend };

  const stateRow = q.findOAuthState(state);
  if (!stateRow) return { error: 'invalid_state', frontend: defaultFrontend };
  q.deleteOAuthState(state);

  const frontend = buildFrontendRedirect(defaultFrontend, stateRow.redirect);
  try {
    const auth = await loginOrCreateWithGoogle(String(code));
    return { auth, frontend };
  } catch (e) {
    console.error('Google OAuth failed:', e);
    return { error: 'oauth_failed', frontend };
  }
}

/** Used by the SPA-side `POST /google/exchange`. */
export async function exchangeGoogleCode(code) {
  if (!code) throw new HttpError(400, 'code is required');
  try {
    return await loginOrCreateWithGoogle(code);
  } catch (e) {
    console.error('Google OAuth failed:', e);
    throw new HttpError(400, 'OAuth exchange failed');
  }
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
  return buildAuthResponse(q.findUserById(user.id));
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

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

function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}
