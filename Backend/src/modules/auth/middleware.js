/**
 * Auth middleware. Required and optional bearer-token auth.
 *
 * Lives in the auth module because it is part of the authentication concern.
 * Used by routes in every other module via `import { requireAuth } from
 * '../auth/middleware.js'`.
 */
import { verifyAccessToken } from './service.js';
import { findUserById } from './queries.js';

/** Reject the request with 401 unless a valid access token is provided. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  const user = findUserById(payload.sub);
  if (!user) return res.status(401).json({ error: 'User no longer exists' });
  req.user = user;
  next();
}

/** Populate `req.user` if a valid token is present, otherwise pass through. */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) req.user = findUserById(payload.sub) || null;
  }
  next();
}
