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

export const findUserByEmailOrUsername = (emailOrUsername) =>
  db.prepare(`SELECT * FROM users WHERE email = ? OR username = ?`)
    .get(emailOrUsername, emailOrUsername);

export const findUserByUsernameOrEmailExact = (username, email) =>
  db.prepare(`SELECT id FROM users WHERE username = ? OR email = ?`)
    .get(username, email);

export const findUserById = (id) =>
  db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);

export const findUserByGoogleId = (googleId) =>
  db.prepare(`SELECT * FROM users WHERE google_id = ?`).get(googleId);

export const findUserByEmail = (email) =>
  db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

export const findUserByUsername = (username) =>
  db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);

export function insertLocalUser({ username, email, passwordHash, fullName, avatarUrl }) {
  const info = db.prepare(`
    INSERT INTO users (username, email, password_hash, full_name, avatar_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, email, passwordHash, fullName, avatarUrl);
  return findUserById(info.lastInsertRowid);
}

export function insertGoogleUser({ username, email, googleId, avatarUrl, fullName }) {
  const info = db.prepare(`
    INSERT INTO users (username, email, google_id, avatar_url, full_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, email, googleId, avatarUrl, fullName);
  return findUserById(info.lastInsertRowid);
}

export function linkGoogleToUser(userId, { googleId, avatarUrl, fullName }) {
  db.prepare(`
    UPDATE users
       SET google_id = ?,
           avatar_url = COALESCE(avatar_url, ?),
           full_name = COALESCE(full_name, ?),
           updated_at = datetime('now')
     WHERE id = ?
  `).run(googleId, avatarUrl, fullName, userId);
}

export function updatePassword(userId, passwordHash) {
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(passwordHash, userId);
}

/* ─── refresh tokens ────────────────────────────────────────────────────── */

export function insertRefreshToken({ userId, token, expiresAt }) {
  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).run(userId, token, expiresAt);
}

export const findActiveRefreshToken = (token) =>
  db.prepare(`SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0`).get(token);

export function revokeRefreshTokenById(id) {
  db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`).run(id);
}

export function revokeRefreshTokenByValue(token) {
  db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE token = ?`).run(token);
}

export function revokeAllRefreshTokensForUser(userId) {
  db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`).run(userId);
}

/* ─── oauth states (CSRF protection for Google flow) ────────────────────── */

export function insertOAuthState({ state, redirect }) {
  db.prepare(`INSERT INTO oauth_states (state, redirect) VALUES (?, ?)`)
    .run(state, redirect);
}

export const findOAuthState = (state) =>
  db.prepare(`SELECT * FROM oauth_states WHERE state = ?`).get(state);

export function deleteOAuthState(state) {
  db.prepare(`DELETE FROM oauth_states WHERE state = ?`).run(state);
}
