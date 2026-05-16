/**
 * Auth service — facade over pluggable providers + provider-agnostic
 * session/token logic.
 *
 * What lives here:
 *   - JWT issuance and verification (access + refresh tokens) — these
 *     are produced by *us*, regardless of how the user authenticated.
 *   - `buildAuthResponse(user)` — wraps a user row into the standard
 *     login/register/refresh response shape.
 *   - `publicUser(user)` — public-facing serialization of a user row.
 *   - Refresh-token rotation and revocation.
 *   - Password-change helpers (used by the users module).
 *   - Thin route-friendly wrappers that look up the right provider
 *     and delegate.
 *
 * What does NOT live here:
 *   - "How to authenticate" (password check, OAuth flow) — that's per
 *     provider in `./providers/*`.
 *
 * See ADR 0005 for the rationale.
 */
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

import { withTransaction } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { hashPassword, verifyPassword } from './lib.js';
import { getProviderOrThrow, listProviders } from './providers/index.js';
import * as q from './queries.js';

const DEV_JWT_SECRET_FALLBACK = 'skillforge-dev-secret-change-me';

/**
 * Guard against shipping a production deployment with an obvious or
 * missing JWT secret. We do this at module-load time so a misconfigured
 * Render / Helm / Compose deploy refuses to boot rather than silently
 * issuing tokens an attacker can forge. The dev fallback is preserved
 * for local development and tests where secrets aren't configured.
 *
 * Production refuses when:
 *   - JWT_SECRET is unset, OR
 *   - JWT_SECRET equals the dev fallback string, OR
 *   - JWT_SECRET is shorter than 32 chars (NIST SP 800-131A floor).
 */
function resolveJwtSecret() {
  const isProd = process.env.NODE_ENV === 'production';
  const value = process.env.JWT_SECRET;
  if (isProd) {
    if (!value || value === DEV_JWT_SECRET_FALLBACK || value.length < 32) {
      throw new Error(
        'JWT_SECRET is required in production and must be a non-default secret of at least 32 characters. '
        + 'Set JWT_SECRET to a long random string (e.g. `openssl rand -base64 48`).',
      );
    }
    return value;
  }
  return value || DEV_JWT_SECRET_FALLBACK;
}

const JWT_SECRET = resolveJwtSecret();
const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TTL || '900', 10); // 15 min
// 7-day default — short enough that a leaked refresh token times out
// quickly, long enough that students don't get bounced out mid-week.
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TTL || '604800', 10); // 7 days

/* ─── password helpers (re-exported for users.service password change) ── */

export { hashPassword, verifyPassword };

/* ─── JWT helpers ───────────────────────────────────────────────────────── */

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000).toISOString();
  await q.insertRefreshToken({ userId, token, expiresAt });
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

/** Wrap a user row into a standard login/register/refresh response. */
export async function buildAuthResponse(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL,
    user: publicUser(user),
  };
}

/* ─── register / login / refresh / logout (route-shaped facades) ────────── */

export async function register(data) {
  const provider = getProviderOrThrow('local');
  if (typeof provider.register !== 'function') {
    throw new HttpError(400, 'Local registration is disabled on this deployment');
  }
  return buildAuthResponse(await provider.register(data));
}

export async function login(data) {
  const provider = getProviderOrThrow('local');
  return buildAuthResponse(await provider.authenticate(data));
}

export async function refresh(refreshToken) {
  if (!refreshToken) throw new HttpError(400, 'refreshToken is required');

  // Wrap in a transaction + row-level lock so two concurrent refresh
  // calls with the same refresh token can't both rotate it. The first
  // wins; the second sees a revoked row and triggers refresh-family
  // invalidation (full revoke for that user) per OWASP guidance.
  return withTransaction(async (tx) => {
    const row = await q.findRefreshTokenForUpdate(refreshToken, tx);
    if (!row) {
      throw new HttpError(401, 'Invalid or expired refresh token');
    }
    if (row.revoked) {
      // Token reuse detected — the legitimate session would have got
      // a brand-new token already. Treat this as compromise of the
      // refresh family and revoke ALL tokens for the user so the
      // attacker's path is closed.
      logger.warn(
        { userId: row.user_id, tokenId: row.id },
        'Refresh token reuse detected — revoking all sessions for user',
      );
      await q.revokeAllRefreshTokensForUser(row.user_id, tx);
      throw new HttpError(401, 'Invalid or expired refresh token');
    }
    if (new Date(row.expires_at) < new Date()) {
      throw new HttpError(401, 'Invalid or expired refresh token');
    }
    await q.revokeRefreshTokenById(row.id, tx);
    const user = await q.findUserById(row.user_id, tx);
    if (!user) throw new HttpError(401, 'Invalid or expired refresh token');
    return buildAuthResponse(user);
  });
}

export async function logout(refreshToken) {
  if (refreshToken) await q.revokeRefreshTokenByValue(refreshToken);
}

/** Revoke all sessions, called when the password changes. */
export function revokeAllForUser(userId) {
  return q.revokeAllRefreshTokensForUser(userId);
}

/** Set a new password hash for a user. Used by users.service.changePassword. */
export function setPasswordHash(userId, hash) {
  return q.updatePassword(userId, hash);
}

/* ─── provider-aware wrappers used by routes ────────────────────────────── */

/** Public: list providers + their runtime status (frontend discovery). */
export function getProviderList() {
  return listProviders();
}

/** Build the OAuth consent-screen redirect URL for the given provider. */
export async function buildOAuthAuthUrl(providerName, opts = {}) {
  const provider = getProviderOrThrow(providerName);
  if (typeof provider.buildAuthUrl !== 'function') {
    throw new HttpError(400, `Provider "${providerName}" does not support redirect-based auth`);
  }
  return provider.buildAuthUrl(opts);
}

/**
 * Handle an OAuth redirect callback. Returns either:
 *   { auth, frontend }           — success: send the SPA there with tokens
 *   { error, frontend }          — failure: send the SPA there with ?error=...
 */
export async function completeOAuthRedirect(providerName, query) {
  const provider = getProviderOrThrow(providerName);
  if (typeof provider.completeAuth !== 'function') {
    throw new HttpError(400, `Provider "${providerName}" does not support redirect-based auth`);
  }
  const result = await provider.completeAuth(query);
  if (result.user) {
    return { auth: await buildAuthResponse(result.user), frontend: result.frontend };
  }
  return { error: result.error, frontend: result.frontend };
}

/** SPA-side direct exchange (no state validation). */
export async function exchangeOAuthCode(providerName, code) {
  const provider = getProviderOrThrow(providerName);
  if (typeof provider.exchangeCode !== 'function') {
    throw new HttpError(400, `Provider "${providerName}" does not support direct code exchange`);
  }
  return buildAuthResponse(await provider.exchangeCode(code));
}

/* ─── operational helpers ───────────────────────────────────────────────── */

/**
 * Periodic sweeper for stale oauth_states rows. Wired into the boot
 * lifecycle in `src/index.js` and runs once per hour. Returns the
 * number of rows deleted, useful for log lines.
 */
export function sweepExpiredOAuthStates() {
  return q.deleteExpiredOAuthStates();
}
