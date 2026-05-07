# Architectural Decision Records (ADR)

This directory captures **significant** architectural decisions for SkillForge.
"Significant" means: a decision that is hard to reverse later, affects multiple
modules, has business/security/compliance implications, or that future
contributors will reasonably ask "why was it built this way?".

## Format

Each file is `NNNN-short-kebab-title.md` and follows a lightweight structure:

- **Status** — `proposed | accepted | superseded by NNNN | deprecated`
- **Context** — what is the problem / forces in play
- **Decision** — what we are doing
- **Consequences** — positive and negative outcomes, what becomes easier/harder

## Index

- [0001](./0001-on-prem-single-tenant.md) — Deployment model: on-prem,
  single-tenant per installation
- [0002](./0002-postgres-versioned-migrations.md) — Move from SQLite to
  PostgreSQL with versioned migrations
- [0003](./0003-modular-monolith-boundaries.md) — Modular monolith with
  enforced module boundaries
- [0004](./0004-isolated-judge-runner.md) — Replace Node `vm` with an
  isolated runner for the JS judge
