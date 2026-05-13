/**
 * ESLint flat config.
 *
 * Two jobs:
 *   1. Catch obvious bugs (no-undef, no-unused-vars).
 *   2. Enforce the modular-monolith boundaries from ADR 0003 via
 *      `no-restricted-imports` rules scoped per-file-pattern.
 *
 * Boundary rules (must match docs/decisions/0003-modular-monolith-boundaries.md):
 *   - queries.js may not import any other module.
 *   - routes.js may not import another module's queries.js, its own queries.js
 *     directly, or shared/db.js. It must go through service.js.
 *   - service.js may not import another module's queries.js. Cross-module
 *     access goes through that module's service.js.
 *
 * If a violation here is intentional and you've thought through the tradeoff,
 * disable the rule on the offending line with a comment explaining *why*.
 */
import js from '@eslint/js';

export default [
  {
    ignores: ['data/**', 'node_modules/**', 'build/**', 'coverage/**'],
  },

  js.configs.recommended,

  /* ── Source files: globals + lenient unused-vars ─────────────────────── */
  {
    files: ['src/**/*.js', 'test/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },

  /* ── queries.js — pure SQL layer, no cross-module imports ────────────── */
  {
    files: ['src/modules/**/queries.js'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../*/queries.js', '../*/service.js', '../*/routes.js', '../*/middleware.js', '../*/schemas.js'],
            message:
              'queries.js cannot import other modules. SQL belongs to one module; cross-module access goes through service.js.',
          },
        ],
      }],
    },
  },

  /* ── routes.js — thin HTTP layer, may not bypass service.js ──────────── */
  {
    files: ['src/modules/**/routes.js'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['./queries.js'],
            message:
              'routes.js must not call queries directly. Move the logic to service.js.',
          },
          {
            group: ['../*/queries.js'],
            message:
              'routes.js must not call another module\'s queries directly. Use that module\'s service.js.',
          },
          {
            group: ['../../shared/db.js'],
            message:
              'routes.js must not access the database directly. Use service.js -> queries.js.',
          },
        ],
      }],
    },
  },

  /* ── service.js — business logic, may use OWN queries + OTHER services ─ */
  {
    files: ['src/modules/**/service.js'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../*/queries.js'],
            message:
              'service.js cannot import another module\'s queries.js. Cross-module access goes through the other module\'s service.js.',
          },
        ],
      }],
    },
  },
];
