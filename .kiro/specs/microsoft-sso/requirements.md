# Requirements Document

## Introduction

Add Microsoft 365 / Azure AD Single Sign-On (SSO) to SkillForge as a new pluggable auth provider. This is critical for enterprise sales to Kazakhstan universities (AITU, KBTU, NU, Satbayev, KazNU), all of which use Microsoft 365 for student and staff email. The implementation follows the existing pluggable auth provider pattern (ADR 0005) and mirrors the Google OAuth provider as a reference implementation.

## Glossary

- **Microsoft_Provider**: The new auth provider module (`modules/auth/providers/microsoft.js`) implementing the common provider interface for Microsoft OAuth 2.0 / OpenID Connect.
- **Azure_AD**: Microsoft's identity platform (Entra ID) that handles authentication via the `login.microsoftonline.com` endpoints.
- **Provider_Registry**: The auth provider registry (`modules/auth/providers/index.js`) that manages provider registration and discovery.
- **Frontend_Discovery_API**: The `GET /api/auth/providers` endpoint that returns available auth providers to the frontend.
- **OIDC**: OpenID Connect — the identity layer on top of OAuth 2.0 used by Azure AD to provide user identity claims.
- **JWKS**: JSON Web Key Set — the public key endpoint Microsoft publishes for validating `id_token` signatures.
- **Account_Linking**: The process of connecting a Microsoft identity to an existing user account that was registered via a different provider (local or Google).

## Requirements

### Requirement 1: Microsoft OAuth Provider Module

**User Story:** As a platform operator, I want a Microsoft OAuth 2.0 / OpenID Connect provider that follows the existing provider interface, so that I can enable Microsoft 365 SSO without modifying existing auth infrastructure.

#### Acceptance Criteria

1. THE Microsoft_Provider SHALL implement the same interface as the Google provider: `{ name, type, enabled(), buildAuthUrl(), completeAuth(), exchangeCode() }`.
2. THE Microsoft_Provider SHALL use Azure AD OAuth 2.0 / OpenID Connect endpoints at `login.microsoftonline.com` for authentication.
3. WHEN `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` environment variables are both set, THE Microsoft_Provider `enabled()` method SHALL return `true`.
4. WHEN either `MICROSOFT_CLIENT_ID` or `MICROSOFT_CLIENT_SECRET` is missing, THE Microsoft_Provider `enabled()` method SHALL return `false`.
5. THE Microsoft_Provider SHALL set `name` to `'microsoft'` and `type` to `'oauth2'`.

### Requirement 2: Tenant Configuration

**User Story:** As a platform operator, I want to configure the Microsoft provider for either a single Azure AD tenant or multi-tenant mode, so that I can restrict login to my university's directory or allow any Microsoft account.

#### Acceptance Criteria

1. WHEN `MICROSOFT_TENANT_ID` is set to a specific tenant GUID, THE Microsoft_Provider SHALL use the single-tenant authorization endpoint `https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize`.
2. WHEN `MICROSOFT_TENANT_ID` is set to `'common'`, THE Microsoft_Provider SHALL use the multi-tenant endpoint `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`.
3. WHEN `MICROSOFT_TENANT_ID` is not set, THE Microsoft_Provider SHALL default to `'common'` (multi-tenant mode).
4. THE Microsoft_Provider SHALL use the same tenant value consistently across the authorize, token, and JWKS endpoints.

### Requirement 3: Provider Registration

**User Story:** As a platform operator, I want to enable the Microsoft provider via the `AUTH_PROVIDERS` environment variable, so that I can control which auth methods are available on my installation.

#### Acceptance Criteria

1. WHEN `AUTH_PROVIDERS` includes `'microsoft'`, THE Provider_Registry SHALL register the Microsoft_Provider as available.
2. WHEN `AUTH_PROVIDERS` does not include `'microsoft'`, THE Provider_Registry SHALL not expose the Microsoft_Provider to any API endpoint.
3. THE Provider_Registry SHALL support configurations such as `AUTH_PROVIDERS=local,google,microsoft` with all three providers active simultaneously.

### Requirement 4: Frontend Discovery

**User Story:** As a frontend developer, I want the providers API to include Microsoft when enabled, so that the login page can dynamically show the Microsoft sign-in button.

#### Acceptance Criteria

1. WHEN the Microsoft_Provider is registered and enabled, THE Frontend_Discovery_API SHALL include `{ name: 'microsoft', type: 'oauth2', enabled: true, supportsOAuthRedirect: true }` in its response.
2. WHEN the Microsoft_Provider is registered but not enabled (missing credentials), THE Frontend_Discovery_API SHALL include `{ name: 'microsoft', type: 'oauth2', enabled: false }` in its response.
3. WHEN the Microsoft_Provider is not registered (not in `AUTH_PROVIDERS`), THE Frontend_Discovery_API SHALL not include any Microsoft entry in its response.

### Requirement 5: OAuth Flow

**User Story:** As a university student or staff member, I want to sign in with my Microsoft 365 account, so that I can access SkillForge using my existing university credentials.

#### Acceptance Criteria

1. WHEN `buildAuthUrl()` is called, THE Microsoft_Provider SHALL generate a redirect URL to the Azure AD authorization endpoint with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, a cryptographic `state` parameter, and a `nonce` parameter.
2. WHEN the user completes consent at Microsoft, THE Microsoft_Provider SHALL receive an authorization code at the configured `MICROSOFT_REDIRECT_URI` callback.
3. WHEN `completeAuth()` receives a valid code and state, THE Microsoft_Provider SHALL exchange the code for tokens at the Azure AD token endpoint using `grant_type=authorization_code`.
4. WHEN tokens are received, THE Microsoft_Provider SHALL extract user information (email, displayName, oid) from the `id_token` claims or the Microsoft Graph `/me` endpoint.
5. IF the `state` parameter does not match a stored OAuth state, THEN THE Microsoft_Provider SHALL reject the callback and return an `invalid_state` error.
6. IF the authorization code exchange fails, THEN THE Microsoft_Provider SHALL log the error and return an `oauth_failed` error with the frontend redirect URL.

### Requirement 6: Token Validation and Security

**User Story:** As a security-conscious operator, I want the Microsoft provider to validate tokens cryptographically, so that forged or tampered tokens cannot grant access.

#### Acceptance Criteria

1. THE Microsoft_Provider SHALL validate the `id_token` signature against Microsoft's JWKS endpoint (`https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`).
2. THE Microsoft_Provider SHALL verify the `id_token` audience (`aud`) matches the configured `MICROSOFT_CLIENT_ID`.
3. THE Microsoft_Provider SHALL verify the `id_token` issuer (`iss`) matches the expected Azure AD issuer for the configured tenant.
4. THE Microsoft_Provider SHALL include a `state` parameter in the authorization request and validate it on callback for CSRF protection.
5. THE Microsoft_Provider SHALL include a `nonce` parameter in the authorization request and validate it in the returned `id_token` to prevent replay attacks.

### Requirement 7: User Creation and Login

**User Story:** As a new university user signing in with Microsoft for the first time, I want an account to be created automatically, so that I do not need a separate registration step.

#### Acceptance Criteria

1. WHEN a user authenticates via Microsoft and no account exists with their Microsoft `oid` or email, THE Microsoft_Provider SHALL create a new user account with the extracted email, display name, and Microsoft `oid`.
2. WHEN a user authenticates via Microsoft and an account already exists with their Microsoft `oid`, THE Microsoft_Provider SHALL log them into the existing account.
3. WHEN creating a new user, THE Microsoft_Provider SHALL generate a unique username derived from the user's email prefix or display name.
4. WHEN the users table is empty (fresh installation), THE Microsoft_Provider SHALL assign the `ADMIN` role to the first user (ADR 0006 bootstrap rule).
5. WHEN the users table is not empty, THE Microsoft_Provider SHALL assign the `STUDENT` role to new users.

### Requirement 8: Account Linking

**User Story:** As a user who already registered with a local password or Google, I want to sign in with my Microsoft account using the same email, so that I do not end up with duplicate accounts.

#### Acceptance Criteria

1. WHEN a user authenticates via Microsoft and no account exists with their Microsoft `oid` but an account exists with the same email, THE Microsoft_Provider SHALL link the Microsoft identity (`oid`) to the existing account.
2. WHEN linking a Microsoft identity to an existing account, THE Microsoft_Provider SHALL update the user's `microsoft_id` field and optionally update `avatar_url` and `full_name` if they are currently null.
3. WHEN an account is linked, THE Microsoft_Provider SHALL return the existing user for JWT issuance without creating a duplicate row.

### Requirement 9: Environment Variables

**User Story:** As a platform operator, I want clear environment variable configuration for the Microsoft provider, so that I can set up SSO during deployment.

#### Acceptance Criteria

1. THE Microsoft_Provider SHALL read `MICROSOFT_CLIENT_ID` for the Azure AD application (client) ID.
2. THE Microsoft_Provider SHALL read `MICROSOFT_CLIENT_SECRET` for the Azure AD client secret.
3. THE Microsoft_Provider SHALL read `MICROSOFT_TENANT_ID` for the Azure AD tenant ID (or `'common'` for multi-tenant).
4. THE Microsoft_Provider SHALL read `MICROSOFT_REDIRECT_URI` for the OAuth callback URL, defaulting to `'http://localhost:4000/api/auth/microsoft/callback'`.
5. THE Microsoft_Provider SHALL read `MICROSOFT_FRONTEND_REDIRECT` for the frontend URL to redirect after auth, defaulting to `'http://localhost:5173/auth/callback'`.

### Requirement 10: Frontend Sign-In Button

**User Story:** As a university user visiting the login page, I want to see a "Sign in with Microsoft" button, so that I can authenticate with my university Microsoft 365 account.

#### Acceptance Criteria

1. WHEN the Frontend_Discovery_API reports Microsoft as enabled, THE frontend login page SHALL display a "Sign in with Microsoft" button.
2. WHEN the Frontend_Discovery_API reports Microsoft as disabled or absent, THE frontend login page SHALL not display the Microsoft sign-in button.
3. THE Microsoft sign-in button SHALL use the official Microsoft brand icon and the text "Sign in with Microsoft" per Microsoft identity branding guidelines.
4. WHEN the user clicks the Microsoft sign-in button, THE frontend SHALL redirect the browser to the URL returned by `GET /api/auth/oauth/microsoft/url`.

### Requirement 11: No New Database Tables

**User Story:** As a developer, I want the Microsoft provider to reuse existing database infrastructure, so that the implementation stays minimal and consistent with the provider abstraction.

#### Acceptance Criteria

1. THE Microsoft_Provider SHALL store the Microsoft `oid` in a `microsoft_id` column on the existing `users` table (requires a single ALTER TABLE migration).
2. THE Microsoft_Provider SHALL reuse the existing `oauth_states` table for CSRF state storage.
3. THE Microsoft_Provider SHALL not create any new database tables.

### Requirement 12: Integration Test Coverage

**User Story:** As a developer, I want comprehensive tests for the Microsoft provider, so that regressions are caught before deployment.

#### Acceptance Criteria

1. WHEN the Microsoft provider is registered, THE test suite SHALL verify that `listProviders()` includes the Microsoft entry with correct `name`, `type`, and `enabled` status.
2. THE test suite SHALL verify that `enabled()` returns `false` when `MICROSOFT_CLIENT_ID` is not set and `true` when both credentials are configured.
3. THE test suite SHALL verify that `buildAuthUrl()` throws a 503 error when the provider is not configured.
4. WHEN credentials are configured, THE test suite SHALL verify that `buildAuthUrl()` returns a URL pointing to `login.microsoftonline.com` with the correct `client_id`, `state`, and `nonce` parameters.
5. THE test suite SHALL verify account linking: when a user with the same email exists, `loginOrCreate` links the Microsoft identity rather than creating a duplicate.
6. THE test suite SHALL verify the first-user-becomes-ADMIN bootstrap rule applies to Microsoft-created accounts.
