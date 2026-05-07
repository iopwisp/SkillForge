/**
 * Optional Sentry / Glitchtip integration.
 *
 * Glitchtip (https://glitchtip.com/) implements the Sentry ingest API and
 * is open-source + self-hostable. It's the natural fit for an on-prem
 * SkillForge deployment that wants error tracking without sending data
 * outside the customer's network.
 *
 * Enabled when `SENTRY_DSN` is set in the environment. Otherwise every
 * function in this file is a no-op and the rest of the app does not need
 * to know whether the SDK is loaded.
 */
import * as Sentry from '@sentry/node';

import { logger } from './logger.js';

let initialized = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    // We only care about errors right now. Performance tracing can be
    // enabled per-deployment by setting SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0'),
    // Match the redaction we do in pino. @sentry/node's `beforeSend` is
    // the simplest place to scrub anything that slipped through.
    beforeSend(event) {
      const headers = event?.request?.headers;
      if (headers) {
        for (const key of ['authorization', 'cookie', 'x-api-key']) {
          if (headers[key]) headers[key] = '[REDACTED]';
        }
      }
      return event;
    },
  });

  initialized = true;
  logger.info({ environment: process.env.NODE_ENV || 'development' }, 'Sentry initialized');
  return true;
}

export function isSentryEnabled() {
  return initialized;
}

/**
 * Forward an exception to Sentry along with optional request context.
 * No-op when Sentry isn't configured. Never throws.
 */
export function captureException(err, { req } = {}) {
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      if (req) {
        if (req.id) scope.setTag('reqId', req.id);
        if (req.method) scope.setTag('method', req.method);
        if (req.url) scope.setTag('path', req.url);
        if (req.user?.id) scope.setUser({ id: req.user.id, username: req.user.username });
      }
      Sentry.captureException(err);
    });
  } catch (sentryErr) {
    // Never let Sentry's own failure mask the original error.
    logger.warn({ err: sentryErr }, 'Sentry captureException failed');
  }
}
