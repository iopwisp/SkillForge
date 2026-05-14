# ADR 0018 — AITU Microsoft SSO email-domain whitelist

## Status

Accepted (2026-05-09).

## Context

Phase 2 ships Microsoft 365 / Azure AD SSO (ADR 0005, the Microsoft
provider). The first paying-track customer is AITU (Astana IT
University). Their tenant ID is `158f15f3-83e0-4906-824c-69bdc50d9d61`,
their primary student/staff email domain is `@astanait.edu.kz`, with
`@edu.astanait.edu.kz` reserved for service accounts.

The pilot deployment will register an Azure AD application in the AITU
Entra ID tenant with **Single tenant only** account type. That alone
restricts sign-in to AITU directory members at the Azure level — no
configuration we set in SkillForge code can be bypassed by a user
choosing a different tenant.

However, single-tenant alone is not always enough:

1. **Guest accounts.** AITU's Entra ID may invite external users
   (visiting professors, contractors, subsidiary universities). These
   guests have non-AITU email addresses but are members of the AITU
   tenant. Single-tenant configuration would let them through.
2. **Multi-tenant fallback.** A future deployment that uses
   `MICROSOFT_TENANT_ID=common` (e.g. a regional self-serve install)
   would have no tenant-level filter at all. Domain whitelist is the
   only line of defence.
3. **Defence in depth.** Misconfiguration is the dominant failure mode.
   If a future operator accidentally deploys with `common` tenant, a
   server-side domain check still blocks unauthorised users.

## Decision

Add an optional environment variable
`MICROSOFT_ALLOWED_DOMAINS=astanait.edu.kz,edu.astanait.edu.kz` (comma
separated). When set, the Microsoft provider rejects any sign-in whose
`id_token` email is not in the list, after the token has been
cryptographically validated against Microsoft's JWKS.

Behaviour:

- **Unset / empty / whitespace-only** → no domain check (current default,
  preserves backward compatibility for non-AITU tenants and for the dev
  loop on a personal Microsoft tenant).
- **Set to one or more domains** → email's domain (case-insensitive)
  must exactly match a whitelisted entry. Substring / suffix matching
  is explicitly NOT performed, so `evil-astanait.edu.kz` is rejected
  even when `astanait.edu.kz` is allowed.

Failure modes:

| Trigger | Result |
|---|---|
| OAuth redirect callback (`completeAuth`) for blocked domain | Returns `{ error: 'domain_not_allowed', frontend }`; user sees friendly Russian message |
| SPA-style code exchange (`exchangeCode`) for blocked domain | Throws `HttpError(403, 'email domain not allowed')` |
| Empty / malformed email | Treated as blocked (same `DOMAIN_NOT_ALLOWED` code) |

The check runs **after** `validateIdToken`, so the email value is one
Microsoft itself signed — never spoofable by the caller.

## Consequences

**Positive**

- AITU pilot is safe even if guest accounts proliferate in their Entra
  ID directory.
- Future multi-tenant deployments (KBTU, NU, Satbayev, KazNU) drop in
  with one extra env var.
- Existing dev loop on a personal Microsoft tenant continues to work
  with `MICROSOFT_ALLOWED_DOMAINS=` unset.
- No new database tables, no migration; the change is environment-only.

**Negative**

- One more env variable to remember at deploy time. Mitigated by the
  ADR pointer in `Backend/.env.example`.
- A misconfigured whitelist (typo in the domain) blocks legitimate
  users until the operator notices. We accept the trade-off — silent
  permissiveness would be worse.

## Operator runbook (AITU)

```env
# Backend/.env on the AITU Render service
AUTH_PROVIDERS=local,google,microsoft
MICROSOFT_CLIENT_ID=<AITU app registration client id>
MICROSOFT_CLIENT_SECRET=<24-month client secret value>
MICROSOFT_TENANT_ID=158f15f3-83e0-4906-824c-69bdc50d9d61
MICROSOFT_REDIRECT_URI=https://<prod-domain>/api/auth/oauth/microsoft/callback
MICROSOFT_FRONTEND_REDIRECT=https://<frontend>/auth/callback
MICROSOFT_ALLOWED_DOMAINS=astanait.edu.kz,edu.astanait.edu.kz
```

The Azure App Registration must additionally have **both** redirect
URIs registered (single match, character-perfect) — the Render-hosted
production callback and the localhost dev callback so internal QA can
keep working without redeploying.
