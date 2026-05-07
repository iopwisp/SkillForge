/**
 * Pure helpers used by the auth module and its providers.
 *
 * Kept separate from `service.js` so that providers (./providers/*) and
 * `service.js` can both depend on these helpers without importing each
 * other (which would risk circular imports).
 *
 * No DB access, no env reading, no side effects.
 */
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

export function defaultAvatar(seed) {
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}
