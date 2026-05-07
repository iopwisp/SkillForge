/**
 * Auth provider registry.
 *
 * On boot, `AUTH_PROVIDERS` (CSV, default `local,google`) selects which
 * providers are available. A provider is *registered* if it appears in
 * AUTH_PROVIDERS, and *enabled* iff its `enabled()` method also returns
 * true (e.g. `google` requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET).
 *
 * Adding a new provider (e.g. Microsoft 365 / Azure AD) is two steps:
 *   1. Drop a `microsoft.js` next to this file implementing the same
 *      shape as `google.js`.
 *   2. Add it to ALL_PROVIDERS below.
 *
 * On-prem operators can disable providers without touching code by
 * setting AUTH_PROVIDERS=local (or local,microsoft, etc.).
 */
import { HttpError } from '../../../shared/errors.js';
import { logger } from '../../../shared/logger.js';
import { googleProvider } from './google.js';
import { localProvider } from './local.js';

const ALL_PROVIDERS = {
  [localProvider.name]: localProvider,
  [googleProvider.name]: googleProvider,
};

const REGISTERED = (process.env.AUTH_PROVIDERS || 'local,google')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Sanity-check the env at boot: any name that isn't in ALL_PROVIDERS gets
// a noisy warning so misconfiguration is obvious in logs.
for (const name of REGISTERED) {
  if (!ALL_PROVIDERS[name]) {
    logger.warn({ provider: name }, 'AUTH_PROVIDERS lists unknown provider — ignoring');
  }
}
if (!REGISTERED.includes('local')) {
  logger.warn('AUTH_PROVIDERS does not include "local"; password login disabled');
}

/** Lookup by name; returns null if not registered or unknown. */
export function getProvider(name) {
  if (!REGISTERED.includes(name)) return null;
  return ALL_PROVIDERS[name] || null;
}

/** Same as getProvider but throws HttpError(400) if missing. */
export function getProviderOrThrow(name) {
  const p = getProvider(name);
  if (!p) throw new HttpError(400, `Unknown or disabled auth provider: ${name}`);
  return p;
}

/**
 * Public listing for the frontend: which providers are currently usable.
 *
 * `enabled` reflects runtime state (env vars present), so frontend can
 * grey out a Google button if credentials aren't configured rather than
 * having it 503 on click.
 */
export function listProviders() {
  return REGISTERED
    .map((name) => ALL_PROVIDERS[name])
    .filter(Boolean)
    .map((p) => ({
      name: p.name,
      type: p.type,
      enabled: p.enabled(),
      // capabilities — useful for the SPA
      supportsRegister: typeof p.register === 'function',
      supportsAuthenticate: typeof p.authenticate === 'function',
      supportsOAuthRedirect: typeof p.buildAuthUrl === 'function',
    }));
}
