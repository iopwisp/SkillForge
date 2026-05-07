/**
 * Local (username/email + password) auth provider.
 *
 * The default and only "password" type provider in Phase 0. Adding LDAP/AD
 * later means writing another provider with the same `authenticate` shape.
 *
 * Provider contract:
 *   { name, type, enabled(), register(...)?, authenticate(...) }
 *
 * `register` is optional in the contract — only the local provider supports
 * self-service account creation. SSO providers won't have it.
 */
import { HttpError } from '../../../shared/errors.js';
import { defaultAvatar, hashPassword, verifyPassword } from '../lib.js';
import * as q from '../queries.js';

export const localProvider = {
  name: 'local',
  type: 'password',

  /** Local auth has no external dependency, so it's always available. */
  enabled() {
    return true;
  },

  /**
   * Create a new local account. Throws HttpError(409) on duplicate
   * username/email. Returns the freshly inserted user row.
   */
  register({ username, email, password, fullName }) {
    if (q.findUserByUsernameOrEmailExact(username, email)) {
      throw new HttpError(409, 'Username or email already taken');
    }
    return q.insertLocalUser({
      username,
      email,
      passwordHash: hashPassword(password),
      fullName: fullName || username,
      avatarUrl: defaultAvatar(username),
    });
  },

  /**
   * Verify credentials and return the user row. Throws HttpError(401)
   * for any failure mode (no user / wrong password / OAuth-only account).
   * The error message is intentionally generic — we do not reveal whether
   * the username exists.
   */
  authenticate({ emailOrUsername, password }) {
    const user = q.findUserByEmailOrUsername(emailOrUsername);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid credentials');
    }
    return user;
  },
};
