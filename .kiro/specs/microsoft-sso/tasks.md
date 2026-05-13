# Implementation Plan: Microsoft 365 / Azure AD SSO

## Overview

Add a Microsoft OAuth 2.0 / OpenID Connect provider to SkillForge following the existing Google provider pattern. Implementation is ~10 sequential tasks, each ending with lint + test green. The provider plugs into the existing auth infrastructure with no changes to middleware, JWT logic, or route structure.

## Tasks

- [x] 1. Add database migration for microsoft_id column
  - Create `db/migrations/0011_microsoft_sso.sql`
  - `ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_id TEXT UNIQUE`
  - `CREATE INDEX IF NOT EXISTS idx_users_microsoft_id ON users(microsoft_id)`
  - Verify migration applies cleanly on the test database
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 2. Add auth query functions for Microsoft provider
  - [x] 2.1 Add `findUserByMicrosoftId(microsoftId, executor)` to `modules/auth/queries.js`
    - `SELECT * FROM users WHERE microsoft_id = $1`
    - _Requirements: 7.2_
  - [x] 2.2 Add `insertMicrosoftUser({ username, email, microsoftId, avatarUrl, fullName, role }, executor)` to `modules/auth/queries.js`
    - INSERT with `microsoft_id` column, RETURNING *
    - _Requirements: 7.1_
  - [x] 2.3 Add `linkMicrosoftToUser(userId, { microsoftId, avatarUrl, fullName }, executor)` to `modules/auth/queries.js`
    - UPDATE existing user: set `microsoft_id`, conditionally update `avatar_url` and `full_name` only if currently NULL
    - _Requirements: 8.1, 8.2_

- [x] 3. Install jose dependency and implement Microsoft provider module
  - [x] 3.1 Install `jose` package for JWKS-based id_token validation
    - `npm install jose@^6`
    - _Requirements: 6.1_
  - [x] 3.2 Create `modules/auth/providers/microsoft.js` implementing the provider interface
    - Export `microsoftProvider` with `name: 'microsoft'`, `type: 'oauth2'`
    - Implement `enabled()` checking `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET`
    - Implement `getTenantId()` returning `MICROSOFT_TENANT_ID` or `'common'`
    - Implement `buildAzureUrl(path)` constructing `https://login.microsoftonline.com/{tenant}/{path}`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 9.1, 9.2, 9.3_
  - [x] 3.3 Implement `buildAuthUrl({ next })` in the Microsoft provider
    - Generate cryptographic `state` (32 hex chars) and `nonce` (32 hex chars)
    - Store state in `oauth_states` with `redirect` as JSON `{ redirect, nonce }`
    - Build Azure AD authorize URL with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `state`, `nonce`
    - Throw HttpError(503) if not enabled
    - _Requirements: 5.1, 6.4, 6.5, 9.4_
  - [x] 3.4 Implement `validateIdToken(idToken, expectedNonce)` using jose
    - Fetch JWKS from `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`
    - Validate signature against JWKS using `jose.jwtVerify` with `createRemoteJWKSet`
    - Verify `aud` matches `MICROSOFT_CLIENT_ID`
    - Verify `iss` matches expected Azure AD issuer pattern
    - Verify `nonce` matches `expectedNonce`
    - Return decoded payload on success
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [x] 3.5 Implement `loginOrCreateWithMicrosoft(idTokenPayload)` 
    - Find user by `oid` (microsoft_id) → return existing user
    - Find user by `email` → link Microsoft identity to existing account
    - Otherwise create new user with derived username (email prefix, sanitized, collision-appended)
    - Apply first-user-becomes-ADMIN bootstrap rule (ADR 0006)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3_
  - [x] 3.6 Implement `completeAuth({ code, state })` and `exchangeCode(code)`
    - `completeAuth`: validate state from DB, delete state row, exchange code for tokens, validate id_token, call loginOrCreate
    - `exchangeCode`: exchange code for tokens, validate id_token (no state check — SPA flow), call loginOrCreate
    - Handle all error paths (missing code, invalid state, exchange failure, validation failure)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 9.5_

- [x] 4. Register Microsoft provider in the provider registry
  - Import `microsoftProvider` in `modules/auth/providers/index.js`
  - Add to `ALL_PROVIDERS` map
  - No other changes needed — existing `REGISTERED` logic handles the rest
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Checkpoint — backend lint + existing tests pass
  - Run `npm run lint` — verify no module boundary violations
  - Run `npm test` — verify all 437+ existing checks still pass
  - Verify the new migration applies on the test DB
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add Microsoft provider unit tests
  - [x] 6.1 Add Microsoft-specific assertions to `test/auth-providers.test.mjs`
    - Test `microsoftProvider.name === 'microsoft'` and `type === 'oauth2'`
    - Test `enabled()` returns false without env vars, true with both set
    - Test `buildAuthUrl()` throws 503 when disabled
    - Test `buildAuthUrl()` returns URL with `login.microsoftonline.com`, correct client_id, state, nonce when enabled
    - Test `listProviders()` includes Microsoft entry with correct shape and capabilities
    - Test account linking: create a local user, then loginOrCreate with same email via Microsoft → same user.id, microsoft_id set
    - Test first-user-becomes-ADMIN bootstrap for Microsoft-created accounts
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 6.2 Write property tests for URL construction (Property 1)
    - **Property 1: Authorization URL construction includes tenant and required parameters**
    - Generate random tenant IDs (GUIDs and 'common') and client IDs
    - Verify URL contains tenant in path, client_id param, response_type=code, scope with openid, state, nonce
    - Minimum 100 iterations
    - **Validates: Requirements 2.1, 2.4, 5.1**

  - [ ]* 6.3 Write property tests for account linking (Property 7)
    - **Property 7: Account linking preserves identity without duplication**
    - Generate random email/name/oid profiles where a user with that email already exists
    - Verify same user.id returned, microsoft_id set, no new row created, existing non-null fields preserved
    - Minimum 100 iterations
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [ ]* 6.4 Write property tests for user creation (Property 5)
    - **Property 5: New user creation with derived username**
    - Generate random Microsoft profiles (email, name, oid) with no pre-existing user
    - Verify user created with correct microsoft_id, email, and valid derived username
    - Minimum 100 iterations
    - **Validates: Requirements 7.1, 7.3**

- [x] 7. Checkpoint — all backend tests pass including new Microsoft tests
  - Run `npm run lint`
  - Run `npm test` — verify new Microsoft assertions pass alongside existing 437+ checks
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Add frontend MicrosoftButton component
  - [x] 8.1 Create `Frontend/Frontend/app/components/common/MicrosoftButton.tsx`
    - Mirror `GoogleButton.tsx` structure
    - Call `GET /api/auth/oauth/microsoft/url` (with `?next=` param)
    - Redirect browser to returned URL via `window.location.assign`
    - Use official Microsoft logo SVG (fluent design, 4-color square)
    - Text: "Sign in with Microsoft"
    - Show "Redirecting…" while loading
    - _Requirements: 10.1, 10.3, 10.4_
  - [x] 8.2 Add MicrosoftButton to login and register pages
    - Import `MicrosoftButton` in `login.tsx` and `register.tsx` (if exists)
    - Render below `GoogleButton`, conditionally based on provider discovery
    - Fetch providers list and only show Microsoft button if `microsoft` entry has `enabled: true`
    - _Requirements: 10.1, 10.2_

- [x] 9. Update .env.example with Microsoft configuration
  - Add `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_FRONTEND_REDIRECT` with comments
  - Document that `MICROSOFT_TENANT_ID` defaults to `'common'` if unset
  - Add `microsoft` to the `AUTH_PROVIDERS` example value
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 10. Final checkpoint — full verification
  - Run `npm run lint` in Backend
  - Run `npm test` in Backend — all checks pass
  - Run `npm run typecheck` in Frontend
  - Run `npm run build` in Frontend
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- The implementation follows the Google provider as a 1:1 template
- No changes to existing auth middleware, JWT logic, or route structure
- The generic `/api/auth/oauth/:provider/*` routes already exist and will serve Microsoft automatically once the provider is registered
- Property tests use the existing `fast-check` devDependency
