# Backend

This folder contains TWO things:

## ✅ `server/` — the active Node.js backend (USE THIS)

The current SkillForge platform runs on a single Node.js + Express + SQLite
backend, located in [`./server/`](./server). It boots in seconds, needs zero
external services, and powers the entire frontend.

**To start:**
```bash
cd server
npm install
npm start          # http://localhost:4000
```

See `server/.env.example` for the active Node backend configuration.
For container platforms such as Render, `Backend/Dockerfile` now builds this
same Node backend from `server/` rather than the legacy Java scaffold.
If you intentionally run the legacy Docker compose stack, use `./.env.example` as the template for `./.env`.
The [project README](../README.md) has the full quick-start.

## 📦 `auth-service/`, `user-service/`, `task-service/`, etc. — legacy Java scaffold

The folders `auth-service/`, `user-service/`, `task-service/`,
`submission-service/`, `notification-service/`, `judge-service/`,
`rating-service/`, `api-gateway/`, `discovery-service/` are an
**unfinished Spring Boot microservices scaffold**.

> **DO NOT START THEM.**

They require:
- PostgreSQL with multiple databases pre-created (`auth_service_db`,
  `user_service_db`, …) and the right credentials
- Apache Kafka + Zookeeper
- Redis
- Eureka discovery server
- Java 21 + Maven

If you try to run them on a fresh machine they will fail with errors like:

```
SQL State : 28P01
Message   : password authentication failed for user "postgres"
```

… because the Postgres user doesn't exist or has different credentials.

The Java code is kept here as a reference for a future production deployment
and is not required for local development. The Node backend in `server/`
exposes the same conceptual API (`/auth/register`, `/auth/login`, problems,
submissions, leaderboard, etc.) and is what the frontend talks to.

If you want to attempt the legacy Docker stack anyway:
```bash
docker compose up
```
…but Docker Desktop must be running, and you'll be waiting a long time.
