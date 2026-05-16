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

/**
 * Acquire a transaction-scoped Postgres advisory lock keyed off a
 * constant. Used to serialise the "first user becomes ADMIN"
 * bootstrap path so two concurrent registrations on a fresh database
 * cannot both observe `isFirstUser() === true` and both insert as
 * ADMIN. The lock is released automatically on COMMIT/ROLLBACK.
 *
 * Caller MUST be inside a transaction (`withTransaction`). The chosen
 * key (7233181) is arbitrary but documented so future advisory locks
 * pick distinct keys.
 */
export const acquireBootstrapLock = (executor = db) =>
  executor.none(`SELECT pg_advisory_xact_lock(7233181)`);

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

/**
 * Same as `findActiveRefreshToken` but takes a row-level lock so two
 * concurrent refresh attempts on the same token can't both rotate it
 * to a new pair. Caller MUST be inside a transaction (`withTransaction`).
 *
 * Returns the row regardless of `revoked` — the service inspects that
 * field to detect token reuse and trigger refresh-family invalidation
 * (revoke all tokens for the user) per OWASP guidance.
 */
export const findRefreshTokenForUpdate = (token, executor = db) =>
  executor.maybeOne(`SELECT * FROM refresh_tokens WHERE token = $1 FOR UPDATE`, [token]);

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

/**
 * Look up an unused, unexpired oauth_states row. The expires_at filter
 * (added in migration 0013) ensures a state row that was issued more
 * than 15 minutes ago can no longer be used to complete a callback —
 * this defends against an attacker who captures a state value in
 * transit and tries to replay it well after the user abandoned the
 * login flow.
 */
export const findOAuthState = (state, executor = db) =>
  executor.maybeOne(
    `SELECT * FROM oauth_states WHERE state = $1 AND expires_at > NOW()`,
    [state],
  );

export function deleteOAuthState(state, executor = db) {
  return executor.none(`DELETE FROM oauth_states WHERE state = $1`, [state]);
}

/**
 * Remove every oauth_states row whose 15-minute window has expired.
 * Returns the number of rows deleted (useful for log lines). Run on a
 * once-per-hour schedule in `src/index.js` so the table doesn't grow
 * unboundedly under traffic.
 */
export async function deleteExpiredOAuthStates(executor = db) {
  const result = await executor.query(
    `DELETE FROM oauth_states WHERE expires_at < NOW()`,
  );
  return result.rowCount ?? 0;
}
