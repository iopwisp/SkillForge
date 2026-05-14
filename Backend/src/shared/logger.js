/**
 * Application logger (pino).
 *
 * Output format:
 *   - production:  JSON one-line-per-event (`pino` default), suitable for
 *                  log aggregators (Loki, Elasticsearch, CloudWatch, etc.)
 *   - test:        JSON, level=warn by default — keeps test output clean
 *                  but lets real errors surface.
 *   - development: pretty-printed via `pino-pretty` (colorized, multi-line
 *                  errors, timestamp).
 *
 * Level: `LOG_LEVEL` env wins; otherwise picks a sensible default per env.
 *
 * Redaction: a small allowlist of paths that we know carry secrets is
 * censored. This is defense in depth — the right primary defense is to
 * never put secrets into log objects in the first place.
 */
import pino from 'pino';
import { createRequire } from 'node:module';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const level = process.env.LOG_LEVEL || (
  isProd ? 'info'
  : isTest ? 'warn'
  : 'debug'
);

const REDACT_PATHS = [
  // request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  // any object with these keys (greedy `*.` covers nested)
  '*.password',
  '*.password_hash',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.refresh_token',
  '*.access_token',
  '*.client_secret',
  '*.JWT_SECRET',
  '*.GOOGLE_CLIENT_SECRET',
];

// Pretty transport is opt-in for local dev. We additionally guard against
// pino-pretty being absent (production installs use `npm ci --omit=dev`
// and don't ship dev-only modules), otherwise pino throws synchronously
// at startup with "unable to determine transport target for pino-pretty"
// — which is exactly what crashed the Render image once NODE_ENV was
// not set to "production".
const requireFromHere = createRequire(import.meta.url);
function isPinoPrettyAvailable() {
  try {
    requireFromHere.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

const usePretty = !isProd && !isTest && isPinoPrettyAvailable();

export const logger = pino({
  level,
  base: {
    service: 'skillforge-server',
    env: process.env.NODE_ENV || 'development',
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  // Pretty transport for local dev only. In CI/test/prod we want plain
  // JSON so logs can be shipped/searched mechanically.
  transport: usePretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      }
    : undefined,
});
