# 0005 — Pluggable auth providers

- **Status:** accepted (implemented)
- **Date:** 2026-05-07

## Context

Phase 0 of SkillForge ships with two ways to authenticate:

1. Local username/email + bcrypt-hashed password.
2. Google OAuth 2.0.

Phase 2 requires several more, in priority order for the Kazakhstan
B2B-EdTech market (per the roadmap in `AGENTS.md`):

1. **Microsoft 365 / Azure AD (Entra ID)** — AITU and most Kazakhstan
   universities run on Microsoft. This is the #1 SSO provider we will
   need for the first paying customer.
2. **Google Workspace** — secondary, some universities.
3. **LDAP / Active Directory** — older state universities.
4. **SAML 2.0** — some procurement reviews require it explicitly.
5. **Generic OIDC** — a fallback that handles "we have our own IdP".

Adding each of these to the existing `auth/service.js` and `auth/routes.js`
without an abstraction would mean cross-cutting edits across both files
every time, with rising risk of subtle differences (state validation,
profile-shape parsing, account linking) drifting between providers.

A second consideration is on-prem deployment. Different universities
will want different sets of providers enabled. Hard-coding which
providers to load makes that impossible without a custom build.

## Decision

We introduce a small **provider plugin** abstraction inside the auth
module. Each provider is a plain object exporting a fixed set of
methods, registered in a central index. The auth service is a thin
facade that looks up the right provider by name and delegates.

### Layout

```
Backend/src/modules/auth/
├── routes.js          HTTP layer
├── service.js         facade — JWT issuance, refresh rotation,
│                      buildAuthResponse, route-shaped wrappers that
│                      look up providers and delegate
├── queries.js         SQL for users + refresh_tokens + oauth_states
├── schemas.js         zod
├── middleware.js      requireAuth / optionalAuth
├── lib.js             pure helpers — bcrypt + defaultAvatar
└── providers/
    ├── index.js       registry + listProviders + getProviderOrThrow
    ├── local.js       password-style: register, authenticate
    └── google.js      oauth2-style: buildAuthUrl, completeAuth, exchangeCode
```

### Provider contract

A provider is a plain object. Mandatory fields:

```ts
{
  name: string;        // 'local' | 'google' | 'microsoft' | 'ldap' | ...
  type: 'password' | 'oauth2' | 'saml';
  enabled(): boolean;  // runtime: are env vars / external deps present?
}
```

Type-specific methods:

```ts
// type === 'password' (local, ldap):
register?({ username, email, password, fullName }): user;
authenticate({ emailOrUsername, password }): user;

// type === 'oauth2' (google, microsoft, generic OIDC):
buildAuthUrl({ next? }): string;
completeAuth({ code, state }): { user, frontend } | { error, frontend };
exchangeCode(code): user;
```

A provider returns a **user row** (the raw DB shape). The auth service
wraps it in `buildAuthResponse(user)` to issue access + refresh tokens
and produce the public JSON. Token issuance is provider-agnostic and
must not move into providers.

### Registry

`AUTH_PROVIDERS` env (CSV, default `local,google`) selects which
providers are *registered*. Each provider's `enabled()` then decides
whether it is *runtime-usable* (e.g. `google.enabled()` is true only
if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set).

The split is deliberate:
- "registered" = "this build/deployment supports this provider"
- "enabled" = "the deployment has actually configured it"

The frontend can call `GET /api/auth/providers` to discover the list
and grey-out buttons for unconfigured providers.

### URL shape

Backward compatibility is preserved for the existing SPA + the Google
OAuth console redirect URI:

```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
GET  /api/auth/google                  (legacy, kept)
GET  /api/auth/google/url              (legacy, kept)
GET  /api/auth/google/callback         (legacy, kept — registered with Google)
POST /api/auth/google/exchange         (legacy, kept)
```

New generic shape, used by every future provider:

```
GET  /api/auth/providers
GET  /api/auth/oauth/:provider
GET  /api/auth/oauth/:provider/url
GET  /api/auth/oauth/:provider/callback
POST /api/auth/oauth/:provider/exchange
```

When we register Microsoft in Phase 2, the redirect URI we hand to
Azure will be `…/api/auth/oauth/microsoft/callback` and no new routes
are needed.

## Consequences

**Positive**
- Adding Microsoft / OIDC = one new file in `providers/` plus a line
  in the registry. No service or route surgery.
- Per-deployment provider control via env: a customer that doesn't
  want Google sets `AUTH_PROVIDERS=local,microsoft`.
- The facade in `service.js` keeps its existing public API
  (`register`, `login`, `refresh`, ...), so the routes layer barely
  changed. The users module's password-change flow continues to work
  unchanged.
- Frontend gets `/providers` to render only the buttons for providers
  the deployment actually has.

**Negative**
- Slight indirection: a route now goes through `service.js → providers
  /index.js → providers/foo.js`. Trivial to follow with grep, but one
  extra hop versus the previous flat structure.
- Providers can in principle drift in subtle behaviors. We mitigate
  that by keeping `buildAuthResponse` (token issuance) and account
  linking (find-by-email + upsert) as shared logic in service / queries
  and only letting providers handle the protocol-specific parts.

## Explicit non-goals

- **No** dependency-injection container, lifecycle hooks, or formal
  plugin spec. Providers are static modules wired at boot.
- **No** support for swapping providers per-request via custom auth
  schemes beyond what HTTP needs.
- **No** account-linking UX for "I have a local account and want to
  add Google" — that already works (Google OAuth links by email)
  and is implemented in `providers/google.js → loginOrCreateWithGoogle`.

## Future re-evaluation

We will revisit if:
- Providers grow shared behavior beyond what the local/google split
  tolerates (e.g. when adding the third or fourth OAuth2 provider we
  may extract a `oauth2-base.js` to deduplicate token exchange and
  upsert logic).
- A customer requires runtime provider hot-reload (very unlikely for
  on-prem) — would replace the static registry with a dynamic one.
