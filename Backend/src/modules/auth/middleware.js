/**
 * Auth middleware. Bearer-token auth + role gating.
 *
 * Lives in the auth module because it is part of the authentication concern.
 * Used by routes in every other module via
 *   `import { requireAuth, requireRole, ROLES } from '../auth/middleware.js'`.
 */
import { verifyAccessToken } from './service.js';
import { findUserById } from './queries.js';

/**
 * Closed set of allowed values for `users.role`. Importing this constant
 * (rather than spelling roles as strings inline) catches typos at lint time
 * — `requireRole(ROLES.AMDIN)` is a SyntaxError, `requireRole('AMDIN')` is
 * a silent 403 in production. See ADR 0006.
 */
export const ROLES = Object.freeze({
  STUDENT: 'STUDENT',
  INSTRUCTOR: 'INSTRUCTOR',
  ADMIN: 'ADMIN',
});

const ROLE_VALUES = new Set(Object.values(ROLES));

/** Look up a Bearer access token and resolve it to a user row, or null. */
async function resolveUserFromAuthHeader(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  const payload = verifyAccessToken(token);
  if (!payload) return null;

  return findUserById(payload.sub);
}

/** Reject the request with 401 unless a valid access token is provided. */
export function requireAuth(req, res, next) {
  Promise.resolve((async () => {
    const header = req.headers.authorization || '';
    const hasBearer = header.startsWith('Bearer ');
    if (!hasBearer) return res.status(401).json({ error: 'Unauthorized' });

    const user = await resolveUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

    req.user = user;
    next();
  })()).catch(next);
}

/** Populate `req.user` if a valid token is present, otherwise pass through. */
export function optionalAuth(req, _res, next) {
  Promise.resolve((async () => {
    req.user = (await resolveUserFromAuthHeader(req)) || null;
    next();
  })()).catch(next);
}

/**
 * Reject the request with 401 (no/bad token) or 403 (token belongs to a
 * user whose role is not in `allowed`). On success, `req.user` is set
 * exactly like `requireAuth`.
 *
 * Usage:
 *   router.put('/users/:id/role', requireRole(ROLES.ADMIN), handler);
 *   router.post('/courses',
 *     requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN), handler);
 *
 * Caller MUST pass at least one role; an empty `allowed` is a programming
 * error and we surface it loudly rather than silently letting everyone
 * through. Each role string MUST be one of `ROLES.*` for the same reason.
 */
export function requireRole(...allowed) {
  if (allowed.length === 0) {
    throw new Error('requireRole called with no roles — would allow everyone');
  }
  for (const role of allowed) {
    if (!ROLE_VALUES.has(role)) {
      throw new Error(`requireRole: unknown role "${role}" (use ROLES.* constants)`);
    }
  }
  const allowedSet = new Set(allowed);

  return function requireRoleMiddleware(req, res, next) {
    Promise.resolve((async () => {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await resolveUserFromAuthHeader(req);
      if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

      if (!allowedSet.has(user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = user;
      next();
    })()).catch(next);
  };
}
