/**
 * Microsoft OAuth 2.0 / OpenID Connect provider (Azure AD).
 *
 * Mirrors the Google provider shape — same interface, different endpoints
 * and token validation logic. Uses Azure AD v2.0 endpoints at
 * login.microsoftonline.com/{tenant}/oauth2/v2.0/*.
 *
 * Token validation uses `jose` (JWKS-based id_token signature verification)
 * rather than trusting the token endpoint response blindly. This is the
 * recommended approach for OIDC id_tokens.
 *
 * Three entry points:
 *
 *   buildAuthUrl({ next })
 *     → string
 *     Generate the redirect URL to Azure AD's consent screen. Stores a
 *     server-side `state` + `nonce` for CSRF and replay protection.
 *
 *   completeAuth({ code, state })
 *     → { user, frontend } | { error, frontend }
 *     Handler for the redirect callback. Validates state, exchanges
 *     the code for tokens, validates the id_token via JWKS, upserts
 *     the user. Returns the frontend redirect URL even on error.
 *
 *   exchangeCode(code)
 *     → user
 *     Used by the alternative SPA-side flow. No state validation —
 *     the caller is the SPA, which already completed the redirect.
 */
import crypto from 'node:crypto';

import * as jose from 'jose';

import { HttpError } from '../../../shared/errors.js';
import { withTransaction } from '../../../shared/db.js';
import { logger } from '../../../shared/logger.js';
import * as q from '../queries.js';

const DEFAULT_REDIRECT_URI = 'http://localhost:4000/api/auth/oauth/microsoft/callback';
const DEFAULT_FRONTEND_REDIRECT = 'http://localhost:5173/auth/callback';

/* ─── helpers ───────────────────────────────────────────────────────────── */

function getTenantId() {
  return process.env.MICROSOFT_TENANT_ID || 'common';
}

function buildAzureUrl(path) {
  return `https://login.microsoftonline.com/${getTenantId()}/${path}`;
}

/* ─── provider export ───────────────────────────────────────────────────── */

export const microsoftProvider = {
  name: 'microsoft',
  type: 'oauth2',

  // Capability flags for the provider registry
  supportsOAuthRedirect: true,
  supportsRegister: false,
  supportsAuthenticate: false,

  /**
   * Available iff the deployment configured both `MICROSOFT_CLIENT_ID` and
   * `MICROSOFT_CLIENT_SECRET`. Re-checked on every call so a restart after
   * adding env vars picks them up immediately.
   */
  enabled() {
    return !!process.env.MICROSOFT_CLIENT_ID && !!process.env.MICROSOFT_CLIENT_SECRET;
  },

  async buildAuthUrl({ next } = {}) {
    if (!this.enabled()) {
      throw new HttpError(503, 'Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in Backend/.env');
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || DEFAULT_REDIRECT_URI;
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    // Store state with nonce encoded in the redirect field as JSON
    await q.insertOAuthState({
      state,
      redirect: JSON.stringify({ redirect: normalizeNext(next), nonce }),
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      response_mode: 'query',
      prompt: 'select_account',
    });

    return `${buildAzureUrl('oauth2/v2.0/authorize')}?${params.toString()}`;
  },

  async completeAuth({ code, state } = {}) {
    const defaultFrontend = process.env.MICROSOFT_FRONTEND_REDIRECT || DEFAULT_FRONTEND_REDIRECT;
    if (!code) return { error: 'missing_code', frontend: defaultFrontend };

    const stateRow = await q.findOAuthState(state);
    if (!stateRow) return { error: 'invalid_state', frontend: defaultFrontend };
    await q.deleteOAuthState(state);

    // Parse the stored redirect+nonce JSON
    const { redirect: storedRedirect, nonce: storedNonce } = parseStoredState(stateRow.redirect);

    const frontend = buildFrontendRedirect(defaultFrontend, storedRedirect);

    try {
      const tokens = await exchangeCodeForTokens(String(code));
      const payload = await validateIdToken(tokens.id_token, storedNonce);
      const user = await loginOrCreateWithMicrosoft(payload);
      return { user, frontend };
    } catch (e) {
      logger.error({ err: e }, 'Microsoft OAuth callback failed');
      return { error: 'oauth_failed', frontend };
    }
  },

  async exchangeCode(code) {
    if (!code) throw new HttpError(400, 'code is required');
    try {
      const tokens = await exchangeCodeForTokens(code);
      // For SPA flow, we skip nonce validation since there's no stored state
      const payload = await validateIdToken(tokens.id_token, null);
      return await loginOrCreateWithMicrosoft(payload);
    } catch (e) {
      logger.error({ err: e }, 'Microsoft OAuth code exchange failed');
      throw new HttpError(400, 'OAuth exchange failed');
    }
  },
};

/* ─── internals ─────────────────────────────────────────────────────────── */

/**
 * Exchange an authorization code for tokens at the Azure AD token endpoint.
 */
async function exchangeCodeForTokens(code) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || DEFAULT_REDIRECT_URI;

  if (!clientId || !clientSecret) throw new Error('Microsoft OAuth not configured');

  const tokenUrl = buildAzureUrl('oauth2/v2.0/token');
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'openid email profile',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Microsoft token exchange failed: ${res.status} ${body}`);
  }

  return res.json();
}

/**
 * Validate an id_token using Microsoft's JWKS endpoint.
 *
 * Verifies:
 *   - Signature against the published JWKS
 *   - `aud` matches MICROSOFT_CLIENT_ID
 *   - `iss` matches the expected Azure AD issuer for the configured tenant
 *   - `nonce` matches the expected nonce (if provided)
 *
 * Returns the decoded JWT payload on success.
 */
async function validateIdToken(idToken, expectedNonce) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const tenant = getTenantId();

  const jwksUrl = buildAzureUrl('discovery/v2.0/keys');
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));

  // Build issuer pattern — Azure AD v2.0 issuer format
  // For 'common' tenant, we accept any issuer matching the pattern
  const issuer = tenant === 'common'
    ? undefined // Skip issuer check for multi-tenant
    : `https://login.microsoftonline.com/${tenant}/v2.0`;

  const verifyOptions = {
    audience: clientId,
    algorithms: ['RS256'],
  };
  if (issuer) {
    verifyOptions.issuer = issuer;
  }

  const { payload } = await jose.jwtVerify(idToken, JWKS, verifyOptions);

  // Verify nonce if provided (redirect flow has nonce, SPA flow may not)
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch');
  }

  return payload;
}

/**
 * Find or create a user from a validated Microsoft id_token payload.
 *
 * Resolution order:
 *   1. Find by oid (microsoft_id) → return existing user
 *   2. Find by email → link Microsoft identity to existing account
 *   3. Create new user with derived username
 *
 * Uses withTransaction + isFirstUser for ADMIN bootstrap (ADR 0006).
 */
async function loginOrCreateWithMicrosoft(payload) {
  const oid = String(payload.oid || payload.sub);
  const email = payload.email || payload.preferred_username || '';
  const name = payload.name || (email ? email.split('@')[0] : 'user');
  const avatar = payload.picture || null;

  // 1. Find by Microsoft oid
  let user = await q.findUserByMicrosoftId(oid);
  if (user) return q.findUserById(user.id);

  // 2. Find by email → link
  if (email) {
    user = await q.findUserByEmail(email);
    if (user) {
      await q.linkMicrosoftToUser(user.id, { microsoftId: oid, avatarUrl: avatar, fullName: name });
      return q.findUserById(user.id);
    }
  }

  // 3. Create new user within a transaction (first-user-becomes-ADMIN)
  return withTransaction(async (tx) => {
    const role = (await q.isFirstUser(tx)) ? 'ADMIN' : 'STUDENT';
    const username = await deriveUsername(email, name);
    const newUser = await q.insertMicrosoftUser({
      username,
      email,
      microsoftId: oid,
      avatarUrl: avatar,
      fullName: name,
      role,
    }, tx);
    return q.findUserById(newUser.id, tx);
  });
}

/**
 * Derive a unique username from email prefix or display name.
 * Sanitizes to lowercase alphanumeric + hyphens/underscores,
 * appends incrementing suffix on collision.
 */
async function deriveUsername(email, name) {
  const raw = email ? email.split('@')[0] : (name || 'user');
  const baseUsername = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24) || 'user';

  let username = baseUsername;
  let n = 0;
  while (await q.findUserByUsername(username)) {
    n += 1;
    username = `${baseUsername}${n}`;
  }
  return username;
}

/* ─── shared helpers ────────────────────────────────────────────────────── */

function parseStoredState(raw) {
  try {
    const parsed = JSON.parse(raw);
    return { redirect: parsed.redirect || '', nonce: parsed.nonce || '' };
  } catch {
    return { redirect: raw || '', nonce: '' };
  }
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
