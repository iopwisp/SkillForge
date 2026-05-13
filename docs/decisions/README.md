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
- [0005](./0005-pluggable-auth-providers.md) — Pluggable auth providers
  (local + google now; Microsoft/OIDC/LDAP/SAML in Phase 2)
- [0006](./0006-user-roles.md) — User roles for university model
- [0007](./0007-courses-model.md) — Courses model and permissions
- [0008](./0008-groups-and-enrolment.md) — Groups, enrolment, and narrowed visibility
- [0009](./0009-exams.md) — Exams with windows and per-student attempts
- [0010](./0010-gradebook-and-csv.md) — Gradebook and CSV export
- [0011](./0011-instructor-problem-creator.md) — Instructor problem creator
- [0012](./0012-audit-log.md) — Audit log for privileged mutations
- [0013](./0013-async-judge-bullmq.md) — Async judge pipeline with BullMQ
- [0014](./0014-polyglot-function-judge.md) — Python/Java/Go function judge
