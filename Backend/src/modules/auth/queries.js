/**
 * SQL for the auth module. Owns:
 *   - users table reads/writes that auth performs (registration, OAuth upsert,
 *     fetch-by-id during token verification)
 *   - refresh_tokens table (issue / rotate / revoke)
 *   - oauth_states table (Google OAuth flow CSRF protection)
 *
 * Other modules that need user data should call `users` service, not this file.
 * This module owns the *write side* of the user lifecycle (signup); the read
 * side for profiles/dashboards lives in the users module.
 */
import { db } from '../../shared/db.js';

/* ─── users ─────────────────────────────────────────────────────────────── */

export const findUserByEmailOrUsername = (emailOrUsername, executor = db) =>
  executor.maybeOne(`SELECT * FROM users WHERE email = $1 OR username = $2`, [emailOrUsername, emailOrUsername]);

export const findUserByUsernameOrEmailExact = (username, email, executor = db) =>
  executor.maybeOne(`SELECT id FROM users WHERE username = $1 OR email = $2`, [username, email]);

export const findUserById = (id, executor = db) =>
  executor.maybeOne(`SELECT * FROM users WHERE id = $1`, [id]);

export const findUserByGoogleId = (googleId, executor = db) =>
  executor.maybeOne(`SELECT * FROM users WHERE google_id = $1`, [googleId]);

export const findUserByEmail = (email, executor = db) =>
  executor.maybeOne(`SELECT * FROM users WHERE email = $1`, [email]);

export const findUserByUsername = (username, executor = db) =>
  executor.maybeOne(`SELECT id FROM users WHERE username = $1`, [username]);

export async function insertLocalUser(
  { username, email, passwordHash, fullName, avatarUrl, role },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO users (username, email, password_hash, full_name, avatar_url, role)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [username, email, passwordHash, fullName, avatarUrl, role]);
}

export async function insertGoogleUser(
  { username, email, googleId, avatarUrl, fullName, role },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO users (username, email, google_id, avatar_url, full_name, role)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [username, email, googleId, avatarUrl, fullName, role]);
}

/**
 * True iff the `users` table is empty. Used to bootstrap the first user
 * on a fresh on-prem installation as ADMIN (ADR 0006). Caller should
 * run this in the same transaction as the subsequent INSERT to keep
 * "first one wins" race-safe.
 */
export const isFirstUser = async (executor = db) => {
  const row = await executor.maybeOne(`SELECT 1 AS one FROM users LIMIT 1`);
  return !row;
};

export function linkGoogleToUser(userId, { googleId, avatarUrl, fullName }, executor = db) {
  return executor.none(`
    UPDATE users
       SET google_id = $1,
           avatar_url = COALESCE(avatar_url, $2),
           full_name = COALESCE(full_name, $3),
           updated_at = NOW()
     WHERE id = $4
  `, [googleId, avatarUrl, fullName, userId]);
}

export function updatePassword(userId, passwordHash, executor = db) {
  return executor.none(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [passwordHash, userId],
  );
}

/* ─── Microsoft SSO (ADR 0005 extension) ─────────────────────────────────── */

/** Find a user by their Azure AD Object ID (oid claim). */
export async function findUserByMicrosoftId(microsoftId, executor = db) {
  return executor.maybeOne(
    `SELECT * FROM users WHERE microsoft_id = $1`,
    [microsoftId],
  );
}

/** Create a new user from Microsoft OAuth. */
export async function insertMicrosoftUser({
  username, email, microsoftId, avatarUrl, fullName, role,
}, executor = db) {
  return executor.maybeOne(`
    INSERT INTO users (username, email, microsoft_id, avatar_url, full_name, role)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [username, email, microsoftId, avatarUrl || null, fullName || null, role]);
}

/**
 * Link a Microsoft identity to an existing user (account linking).
 * Only updates avatar_url and full_name if they are currently NULL
 * (preserves user's existing profile data).
 */
export async function linkMicrosoftToUser(userId, { microsoftId, avatarUrl, fullName }, executor = db) {
  return executor.maybeOne(`
    UPDATE users
       SET microsoft_id = $2,
           avatar_url = COALESCE(avatar_url, $3),
           full_name = COALESCE(full_name, $4)
     WHERE id = $1
    RETURNING *
  `, [userId, microsoftId, avatarUrl || null, fullName || null]);
}

/* ─── refresh tokens ────────────────────────────────────────────────────── */

export function insertRefreshToken({ userId, token, expiresAt }, executor = db) {
  return executor.none(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt],
  );
}

export const findActiveRefreshToken = (token, executor = db) =>
  executor.maybeOne(`SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE`, [token]);

export function revokeRefreshTokenById(id, executor = db) {
  return executor.none(`UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1`, [id]);
}

export function revokeRefreshTokenByValue(token, executor = db) {
  return executor.none(`UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1`, [token]);
}

export function revokeAllRefreshTokensForUser(userId, executor = db) {
  return executor.none(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`, [userId]);
}

/* ─── oauth states (CSRF protection for Google flow) ────────────────────── */

export function insertOAuthState({ state, redirect }, executor = db) {
  return executor.none(`INSERT INTO oauth_states (state, redirect) VALUES ($1, $2)`, [state, redirect]);
}

export const findOAuthState = (state, executor = db) =>
  executor.maybeOne(`SELECT * FROM oauth_states WHERE state = $1`, [state]);

export function deleteOAuthState(state, executor = db) {
  return executor.none(`DELETE FROM oauth_states WHERE state = $1`, [state]);
}
