import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'skillforge-dev-secret-change-me';
const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TTL || '900', 10);     // 15 min
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TTL || '2592000', 10); // 30 days

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000).toISOString();
  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).run(userId, token, expiresAt);
  return token;
}

export function rotateRefreshToken(token) {
  const row = db.prepare(
    `SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0`
  ).get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`).run(row.id);
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.user_id);
  if (!user) return null;
  return { user, newRefresh: issueRefreshToken(user.id) };
}

export function revokeRefreshToken(token) {
  db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE token = ?`).run(token);
}

export function revokeAllForUser(userId) {
  db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`).run(userId);
}

/** Express middleware: require a valid access token. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(payload.sub);
  if (!user) return res.status(401).json({ error: 'User no longer exists' });
  req.user = user;
  next();
}

/** Optional auth — populates req.user if a valid token is present, otherwise lets the request through. */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      req.user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(payload.sub) || null;
    }
  }
  next();
}

export function buildAuthResponse(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = issueRefreshToken(user.id);
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL,
    user: publicUser(user),
  };
}

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
