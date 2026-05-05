# SkillForge

A modern, focused coding-practice platform — like LeetCode, but covering
**algorithms, SQL, backend & frontend** tasks under one roof, with a clean,
unique design and a self-contained local stack. Practice problems, track
progress, climb the leaderboard, and ship like a pro. 🐘

## ✨ Features

- 🔐 **Auth** — register, login, JWT access + refresh tokens, password change
- 🟦 **Google OAuth** — server-side flow, auto-creates users, links existing accounts
- 🧩 **58 seeded problems** across 14 categories — 24 algorithm + 10 backend + 10 frontend + 14 SQL
- ⚖️ **Real judges** — SQL queries run against an in-memory SQLite, JS solutions
  execute in a Node `vm` sandbox with hard timeouts. Wrong answers get a real
  `Expected vs Actual` diff, infinite loops get TLE, missing functions get
  COMPILE_ERROR.
- 🚀 **Dashboard, problems list, problem-detail workspace** with type filter
  (Algorithm / Backend / Frontend / SQL) and a per-problem **Schema** tab that
  shows table layouts and sample rows for SQL tasks
- 🏆 **Leaderboard** with podium, **profile pages** with activity heatmaps
- 📜 **Submissions history**, ⭐ **favourites**, ⚙️ **settings**, **dark/light theme**
- 📱 Fully responsive, accessible, keyboard-friendly
- ⚡ Boots in seconds — no Docker, no Kafka, no Postgres required

## 🧱 Stack

| Layer    | Tech                                                                |
| -------- | ------------------------------------------------------------------- |
| Frontend | React 19, React Router 7 (SPA), Tailwind v4, shadcn/ui, lucide-react|
| Backend  | Node 20+, Express 4, SQLite (`better-sqlite3`), Zod, JWT, bcryptjs  |
| OAuth    | Google OAuth 2.0 (manual implementation, zero deps)                 |
| Database | SQLite (file: `Backend/server/data/skillforge.db`)                  |

> The repo also contains a **legacy Java + Spring Boot microservice scaffold** in
> `Backend/{auth-service,user-service,task-service,...}`. It is **not** what the
> SPA talks to (the SPA points at the Node server). The Java services build
> cleanly with `cd Backend && mvn -DskipTests package` and run with the bundled
> `docker-compose.yml`, but require Postgres + Kafka + Redis + Eureka — only
> bring them up if you actually want to play with the microservice flavour.
>
> **Kafka host port:** to avoid collisions with any other Kafka you may already
> have running on `9092`, the compose stack exposes its broker on host port
> `19092` (internal services still use `kafka:9092` on the docker network).
> Override with `KAFKA_HOST_PORT=9092 docker compose up -d` if you want it back.

## 🚀 Quick start (Windows, macOS, Linux)

You need **Node.js 20+** installed. Nothing else.

### 1. Backend — `http://localhost:4000`

```bash
cd Backend/server
npm install
npm start
```

On first start, it auto-creates `data/skillforge.db` and seeds it with **58 problems across 14 categories** (24 algorithm + 10 backend + 10 frontend + 14 SQL). You should see:

```
⚒️ SkillForge backend running at http://localhost:4000
   API base:  http://localhost:4000/api
   Health:    http://localhost:4000/api/health
   ⚠️  Google OAuth disabled — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
```

> Want to verify the judges? `npm test` runs all 48 reference-solution tests
> against the real SQL and JS judges in ~1 second.

### 2. Frontend — `http://localhost:5173`

In a second terminal:

```bash
cd Frontend/SkillForge-Frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser. ✨

### Optional: production build of the frontend

```bash
cd Frontend/SkillForge-Frontend
npm run build
npm start              # serves the SPA on http://localhost:3000
```

## 👤 Accounts

The backend no longer creates demo users. Register a real account from the UI
after first boot, or configure Google OAuth if you want federated sign-in.

## 🔐 Google OAuth

Out of the box, the Google button on the login/register pages will show a
graceful error until you configure credentials. To enable real Google sign-in:

1. Go to <https://console.cloud.google.com/apis/credentials>
2. Create an **OAuth 2.0 Client ID** of type **Web application**
3. Add **Authorised JavaScript origins**: `http://localhost:5173`
4. Add **Authorised redirect URIs**: `http://localhost:4000/api/auth/google/callback`
5. Copy the *Client ID* and *Client Secret* into `Backend/server/.env`:

   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

6. Restart the backend (`npm start`).

How the flow works:

```
[Frontend] /login  →  click "Continue with Google"
   ↓
[Backend]  GET /api/auth/google
   ↓ generates state, redirects to accounts.google.com
[Google]   user consents
   ↓
[Backend]  GET /api/auth/google/callback?code=...
   ↓ exchanges code → tokens → userinfo
   ↓ creates user (or links by email/sub)
   ↓ issues JWT access + refresh tokens
   ↓ redirects with tokens to:
[Frontend] /auth/callback?accessToken=...&refreshToken=...
   ↓ stores tokens, refreshes user, navigates to /dashboard
```

New users are auto-created from their Google profile (name, email, picture).
Existing users with a matching email are linked to the Google sub.

## 🎯 Problem types & judges

Every problem belongs to one of four types. The judge is picked automatically
based on `problem_type`:

| Type        | Judge                                | What students write                                    |
| ----------- | ------------------------------------ | ------------------------------------------------------ |
| `ALGORITHM` | Token-match heuristic (legacy)       | Solution function in any of 5 languages                |
| `SQL`       | Real, in-memory SQLite               | A `SELECT` query against a fresh seeded database       |
| `BACKEND`   | Real, Node `vm` sandbox + 1s timeout | A JavaScript / TypeScript function                     |
| `FRONTEND`  | Real, Node `vm` sandbox + 1s timeout | A JavaScript / TypeScript pure function                |

For SQL/BACKEND/FRONTEND tasks, every submission is graded against multiple
test cases. Wrong answers come back with the failing test's name plus a
`Expected vs Actual` diff, so students get real feedback rather than a yes/no.
The `Run` button executes the same judge but doesn't persist a submission or
affect rating.

### What's seeded

| Category | Examples                                                                              |
| -------- | ------------------------------------------------------------------------------------- |
| Backend  | parse-query-string, build-query-string, safe-json-parse, paginate, slugify, …         |
| Frontend | format-bytes, time-ago, kebab-case, chunk-array, breadcrumbs, filter-tree, …          |
| SQL      | filter / distinct / order-by, joins, group-by + having, self-join, window functions, … |

### Adding more problems

Each set lives in its own file so it's trivial to extend:

```
Backend/server/src/seeds/
├── backend.js   ← BACKEND_PROBLEMS array
├── frontend.js  ← FRONTEND_PROBLEMS array
└── sql.js       ← SQL_PROBLEMS array (with shared SHOP/HR/BLOG schemas)
```

A new problem just needs `slug`, `title`, `difficulty`, `category`,
`description`, `starterCode`, `testCases` and (for SQL) a `sqlSetup` script —
the seed picks them up on the next `npm run seed` (or fresh boot).

## 🗂 API surface

All routes are under `/api`. Auth endpoints are rate-limited.

| Method | Path                              | Auth | Description                    |
| ------ | --------------------------------- | ---- | ------------------------------ |
| GET    | `/health`                         | —    | Health check                   |
| POST   | `/auth/register`                  | —    | Create account                 |
| POST   | `/auth/login`                     | —    | Email/username + password      |
| POST   | `/auth/refresh`                   | —    | Rotate refresh token           |
| POST   | `/auth/logout`                    | —    | Revoke refresh token           |
| GET    | `/auth/me`                        | ✅   | Current user                   |
| GET    | `/auth/google`                    | —    | Start OAuth flow               |
| GET    | `/auth/google/callback`           | —    | OAuth callback                 |
| POST   | `/auth/google/exchange`           | —    | (alt) SPA-side code exchange   |
| GET    | `/categories`                     | —    | All categories                 |
| GET    | `/problems`                       | opt  | Filter/search problems         |
| GET    | `/problems/:slug`                 | opt  | Problem with description       |
| POST   | `/problems/:slug/favorite`        | ✅   | Toggle favourite               |
| POST   | `/submissions/:slug`              | ✅   | Submit code                    |
| POST   | `/submissions/:slug/run`          | ✅   | Run sample tests only          |
| GET    | `/submissions/me`                 | ✅   | My full history                |
| GET    | `/submissions/problem/:slug`      | ✅   | My history for a problem       |
| GET    | `/submissions/recent`             | —    | Public recent activity         |
| GET    | `/users/leaderboard`              | —    | Top 100 by rating              |
| GET    | `/users/profile/:username`        | opt  | Public profile + stats         |
| GET    | `/users/me/dashboard`             | ✅   | My personal dashboard data     |
| GET    | `/users/me/favorites`             | ✅   | My favourited problems         |
| PATCH  | `/users/me`                       | ✅   | Update profile                 |
| POST   | `/users/me/password`              | ✅   | Change password                |

## ⚙️ Environment variables

Copy `.env.example` → `.env` in each side and tweak as needed:

### `Backend/server/.env`
| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API listen port |
| `DATABASE_FILE` | `./data/skillforge.db` | SQLite path |
| `JWT_SECRET` | _(change me)_ | Signing key for access tokens |
| `JWT_ACCESS_TTL` | `900` | Access token lifetime (s) |
| `JWT_REFRESH_TTL` | `2592000` | Refresh token lifetime (s) |
| `GOOGLE_CLIENT_ID` | empty | OAuth client id |
| `GOOGLE_CLIENT_SECRET` | empty | OAuth secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:4000/api/auth/google/callback` | Backend OAuth callback |
| `GOOGLE_FRONTEND_REDIRECT` | `http://localhost:5173/auth/callback` | Where to bounce the browser after success |
| `CORS_ORIGIN` | `http://localhost:5173,...` | Comma-separated allowlist |

### `Backend/.env` _(legacy Docker Compose stack only)_
This file is only for the legacy Spring microservices scaffold in `Backend/docker-compose.yml`.
Keep real values in local `Backend/.env` and commit only `Backend/.env.example`.

| Var | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` | `postgres` | Shared Postgres username for the compose stack |
| `POSTGRES_PASSWORD` | _(change me)_ | Shared Postgres password for the compose stack |
| `POSTGRES_DB` | `taskhub` | Default database used by the Postgres container |
| `POSTGRES_MULTIPLE_DATABASES` | service DB list | Databases created by the init script |
| `SPRING_PROFILES_ACTIVE` | `prod` | Spring profile for all legacy services |
| `JWT_SECRET` | _(change me)_ | Shared JWT signing secret for legacy services |
| `EUREKA_URL` | `http://discovery-service:8761/eureka/` | Eureka discovery URL |
| `REDIS_HOST` | `redis` | Redis hostname inside compose |
| `KAFKA_SERVERS` | `kafka:9092` | Kafka bootstrap servers inside compose |
| `KAFKA_HOST_PORT` | `19092` | Host port exposed for Kafka |
| `MAIL_USERNAME` | `placeholder@example.com` | SMTP username for notification-service |
| `MAIL_PASSWORD` | _(change me)_ | SMTP password for notification-service |

### `Frontend/Frontend/.env`
| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000/api` | Backend base URL the SPA calls |

## 📁 Project structure

```
SkillForge/
├── Backend/
│   ├── server/                  ← ⭐ Node + SQLite backend (use this)
│   │   ├── src/
│   │   │   ├── index.js         server bootstrap
│   │   │   ├── db.js            SQLite schema + connection + auto-migrations
│   │   │   ├── auth.js          JWT + bcrypt helpers, middleware
│   │   │   ├── judge.js         real SQL & JS judges (sandboxed, with diff)
│   │   │   ├── seed.js          24 algorithm problems, 14 categories, 6 users
│   │   │   ├── seeds/
│   │   │   │   ├── backend.js   10 backend tasks (HTTP/JSON/parsing helpers)
│   │   │   │   ├── frontend.js  10 frontend tasks (formatters, trees, UI)
│   │   │   │   └── sql.js       14 SQL tasks (joins, GROUP BY, window funcs)
│   │   │   └── routes/
│   │   │       ├── auth.js          register, login, refresh, /me, Google OAuth
│   │   │       ├── problems.js      list, detail, favourites (filter by type)
│   │   │       ├── categories.js
│   │   │       ├── submissions.js   submit, run, history (real judges)
│   │   │       └── users.js         profile, dashboard, leaderboard, settings
│   │   ├── test/                judge + reference-solution tests (npm test)
│   │   ├── data/                created on first boot (SQLite WAL files)
│   │   ├── package.json
│   │   └── .env / .env.example
│   │
│   ├── auth-service/  ┐
│   ├── user-service/  │
│   ├── task-service/  │
│   ├── api-gateway/   │  legacy Java/Spring scaffold — boots only with the
│   ├── ...            │  full Docker compose stack (Postgres + Kafka + Redis
│   ├── docker-compose.yml │  + Eureka). Builds with `cd Backend && mvn package`.
│   └── pom.xml        ┘
│
└── Frontend/
    └── SkillForge-Frontend/
        ├── app/
        │   ├── root.tsx                     root layout, providers
        │   ├── routes.ts                    route table
        │   ├── routes/                      one file per page
        │   │   ├── landing.tsx              marketing landing
        │   │   ├── login.tsx, register.tsx, auth-callback.tsx
        │   │   ├── dashboard.tsx, problems.tsx, problem-detail.tsx
        │   │   ├── categories.tsx, leaderboard.tsx, profile.tsx
        │   │   ├── submissions.tsx, favorites.tsx, settings.tsx
        │   │   └── not-found.tsx
        │   ├── components/
        │   │   ├── layout/AppShell.tsx      sidebar + topbar shell
        │   │   ├── brand/Logo.tsx           gradient mammoth-tusk mark
        │   │   ├── common/                  DifficultyBadge, StatusBadge, …
        │   │   └── ui/                      shadcn/ui primitives
        │   └── lib/
        │       ├── api.ts                   fetch client + auto refresh
        │       ├── auth.tsx                 AuthProvider + useAuth
        │       ├── theme.tsx                ThemeProvider + useTheme
        │       ├── guards.tsx               <ProtectedRoute>
        │       ├── format.ts                helpers (timeAgo, etc.)
        │       └── types.ts
        ├── styles/                          theme.css, fonts.css, tailwind.css
        ├── react-router.config.ts           ssr:false (SPA)
        ├── vite.config.ts
        └── package.json
```

## 🧪 Smoke test

A Playwright-based smoke test was used during development:

```
✔ /                       PASS
✔ /login                  PASS
✔ /register               PASS
✔ /some-bogus → 404       PASS
✔ /problems               PASS  (24 problems load)
✔ /leaderboard            PASS  (empty + ranked states render)
✔ /categories             PASS
✔ /u/<username>           PASS  (profile loads)
✔ /problems/two-sum       PASS  (workspace renders)
✔ auth flow               PASS  (register → login → /dashboard)
✔ /dashboard              PASS
✔ /submissions            PASS
✔ /favorites              PASS
✔ /settings               PASS
✔ submit two-sum          PASS  (verdict appears)

═══ 15/15 passed ═══
```

## 🧹 Resetting the database

```bash
cd Backend/server
rm -rf data/
npm start    # auto-seeds again
```

## 📝 What was changed in this repo

**What was broken**

- Legacy Java microservice scaffold (9 services) couldn't start: requires
  Postgres with credentials, Kafka, Redis, Eureka, and Docker — none of which
  were running. Auth-service was crashing with `28P01: password authentication
  failed for user "postgres"`.
- Frontend `package.json` was missing 30+ dependencies (`@radix-ui/*`,
  `lucide-react`, `class-variance-authority`, `tailwind-merge`,
  `react-resizable-panels`, `recharts`, `sonner`, `vaul`, `cmdk`,
  `react-hook-form`, `next-themes`, `tw-animate-css`, …).
- Frontend used `createBrowserRouter` while the build pipeline expected React
  Router 7 framework mode (`root.tsx` + `routes.ts`) — incompatible.
- `app/components/ui/sonner.tsx` re-imported itself (`~/components/ui/sonner`),
  causing a circular import.
- `app/components/ui/input-otp.tsx` had the same issue.
- `react-resizable-panels` resolved to a major version with an incompatible API.
- Existing pages used "LeetCode" branding, were showcases not real pages, and
  had no API connection or auth.

**What was fixed / built**

- ✅ Brand-new Node.js + Express + SQLite backend at `Backend/server/`
  (no Docker, boots in seconds).
- ✅ Full JWT auth: register, login, logout, refresh-token rotation, `/me`,
  rate-limited.
- ✅ Working Google OAuth (server-driven flow, links existing users).
- ✅ Stable APIs for problems, categories, submissions, leaderboard, profile,
  favourites, dashboard, settings.
- ✅ Frontend rebrand, React Router 7 framework mode, 13 real pages, auth
  context, dark/light theme.

**What was added in 1.1 (release)**

- ✅ **Real judges** for SQL and JS (`Backend/server/src/judge.js`):
  - SQL → fresh `:memory:` SQLite per test, ordered/unordered row diff,
    blocks `PRAGMA`/`ATTACH`/`DETACH`/`VACUUM`.
  - JS → Node `vm` sandbox, hard 1 s timeout per call (kills tight infinite
    loops via V8 interrupts), supports both `function name(){}` and
    `module.exports.name = …` styles.
- ✅ **34 new student tasks**:
  - 10 backend (parse-query-string, build-query-string, paginate, slugify,
    rate-limit-counter, diff-objects, resolve-redirects, …)
  - 10 frontend (format-bytes, time-ago, kebab-case, breadcrumbs, filter-tree,
    paginate-pager, highlight-search, …)
  - 14 SQL (basic SELECT/WHERE through joins, GROUP BY + HAVING, self-join,
    second-highest-salary, RANK() and SUM() OVER window functions)
- ✅ **Schema viewer** in the problem-detail page — for SQL problems we parse
  the seed DDL/DML and render a per-table preview of columns + first 10 rows.
- ✅ **Type filter** on the Problems list, plus a coloured pill on each row
  indicating Algorithm / Backend / Frontend / SQL.
- ✅ **Per-problem language picker** that only shows languages the judge can
  actually run (SQL for SQL tasks, JS/TS for backend & frontend tasks, all 5
  for legacy algorithm tasks).
- ✅ **Reference-solution test suite** (`npm test` in `Backend/server/`) — 48
  reference solutions run through the real judge in ~1 second and assert that
  every shipped problem is solvable with the test cases as defined.
- ✅ **Java microservice scaffold builds again**: bumped Lombok from the
  non-existent `1.18.44` to `1.18.30`, added the missing `<version>` to every
  `<annotationProcessorPaths>`, fixed `auth-service`'s `/me` returning 500
  instead of 401 on missing `Authorization` header, and made the Mockito
  surefire run on JDK 23+ via `-Dnet.bytebuddy.experimental=true`.

## 🛣 Possible follow-ups

- WebSocket-based live submission status
- Discussions / comments per problem
- Contests with timed leaderboard
- Email-based password reset
- More OAuth providers (GitHub, Apple)
- Replace the heuristic ALGORITHM judge with full sandboxed execution per
  language (Python, Java, C++) using Docker isolates

---

Built with ❤️ as a focused, modern alternative to bloated coding platforms.
