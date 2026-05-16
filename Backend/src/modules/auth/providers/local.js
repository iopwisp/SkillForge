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
import { withTransaction } from '../../../shared/db.js';
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
   *
   * Wrapped in a transaction so the duplicate-check, the
   * "is this the first user on a fresh install?" check (ADR 0006),
   * and the INSERT all see a consistent snapshot.
   */
  async register({ username, email, password, fullName }) {
    return withTransaction(async (tx) => {
      // Serialise concurrent first-user registrations so two parallel
      // POSTs against an empty database can't both observe
      // `isFirstUser() === true` and both insert as ADMIN.
      await q.acquireBootstrapLock(tx);

      if (await q.findUserByUsernameOrEmailExact(username, email, tx)) {
        throw new HttpError(409, 'Username or email already taken');
      }
      const role = (await q.isFirstUser(tx)) ? 'ADMIN' : 'STUDENT';
      return q.insertLocalUser({
        username,
        email,
        passwordHash: hashPassword(password),
        fullName: fullName || username,
        avatarUrl: defaultAvatar(username),
        role,
      }, tx);
    });
  },

  /**
   * Verify credentials and return the user row. Throws HttpError(401)
   * for any failure mode (no user / wrong password / OAuth-only account).
   * The error message is intentionally generic — we do not reveal whether
   * the username exists.
   */
  async authenticate({ emailOrUsername, password }) {
    const user = await q.findUserByEmailOrUsername(emailOrUsername);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid credentials');
    }
    return user;
  },
};
