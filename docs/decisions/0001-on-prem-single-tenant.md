# 0001 — Deployment model: on-prem, single-tenant per installation

- **Status:** accepted
- **Date:** 2026-05-07

## Context

SkillForge is being evolved into a B2B coding-practice platform sold to
universities (initial target market: Kazakhstan, starting with AITU as the
pilot customer). University procurement and IT departments in this market
strongly prefer to host student-data-processing applications inside the
university's own infrastructure (data residency, security review, internal
compliance). A SaaS-only model would lose deals before they start.

We considered three options:

1. **SaaS-only.** Simpler operations, faster iteration, but loses
   data-residency-sensitive customers. Disqualified for the target market.
2. **Multi-tenant SaaS with optional on-prem.** Maximum flexibility but
   architecturally expensive: requires `tenant_id` on every table,
   row-level security, tenant-aware caching, and per-tenant migrations.
   Premature for a pre-revenue product.
3. **On-prem, single-tenant per installation.** Each university gets a
   dedicated deployment of the full stack. Data isolation by deployment
   boundary, not by application logic.

## Decision

We adopt **on-prem, single-tenant per installation** as the deployment model.

Implications:
- No `tenant_id` columns in the database schema.
- No tenant-aware middleware; the application assumes it owns its database.
- Distribution unit is a `docker compose` stack; later, a Helm chart when a
  customer asks for it. Helm is **not** a near-term priority.
- We avoid managed-only / cloud-proprietary services. Every dependency must
  be runnable inside a customer's data center.
- Configuration is via `.env` and config files, not via control-plane APIs.
- Upgrades are explicit, customer-initiated `./upgrade.sh` runs, not
  background-pushed.

## Consequences

**Positive**
- Removes the largest source of B2B-EdTech architectural complexity early.
- Easier security review with customers (data never leaves their network).
- No noisy-neighbor or cross-tenant data-leak class of bugs.
- Backups are per-installation and trivial (`pg_dump`).

**Negative**
- One installation per customer = operational cost grows linearly with
  customer count. Acceptable for the first ~10 universities.
- Rolling out fixes is asynchronous (each customer upgrades on their schedule).
  This forces stricter API/schema versioning discipline (see ADR 0002).
- Cannot offer "instant signup" SaaS to small teams or individual
  instructors without a separate, optional hosted service in the future.

## Future re-evaluation

We will revisit this decision if:
- ≥3 customers explicitly request a hosted SaaS option, OR
- Operational overhead per installation exceeds ~4 hours/month, OR
- We open a market segment (small colleges, bootcamps) where on-prem is a
  blocker rather than a feature.
