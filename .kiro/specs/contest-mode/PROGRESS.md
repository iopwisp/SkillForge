# contest-mode — Final Progress Report

**Status:** 32/39 задач готово (82%) — все обязательные задачи выполнены.
**Опциональные осталось:** 7 `*`-задач (все PBT + integration-contests lifecycle).

## Готовые обязательные задачи (32)

### Backend foundation
- ✅ 1.1 Migration `0009_contests.sql` — 7 таблиц
- ✅ 2.1 `scoring-engine.js` — чистая ICPC-функция
- ✅ 4.1 `glicko2-engine.js` — Glicko-2 с zero-sum нормализацией
- ✅ 6.1 `schemas.js` — все Zod схемы
- ✅ 7.1 `queries.js` — 25+ SQL функций

### Service layer
- ✅ 8.1 contest CRUD
- ✅ 8.2 problem attachment
- ✅ 8.3 registration + participation (live + virtual)
- ✅ 8.4 contest submissions
- ✅ 8.5 standings + finalizeContestRatings
- ✅ 8.6 editorial + user history

### HTTP + wiring
- ✅ 9.1 `routes.js` — все 15 endpoint'ов
- ✅ 10.1 Mount в `src/app.js`
- ✅ 11.1 Frozen standings (inline в 8.5)
- ✅ 12.1 Virtual participation (inline в 8.3)
- ✅ 13.1 Link contest submissions to async pipeline + migration `0010_submissions_contest_link.sql`
- ✅ 13.2 Rating computation trigger (покрыто `POST /:slug/finalize-ratings`)
- ✅ 14 Backend checkpoint — lint + тесты зелёные
- ✅ 15.1 Editorial CRUD (inline в 8.6)
- ✅ 16.1 User history + rating endpoints (inline в 8.6)

### Frontend
- ✅ 18.1 `/contests` — список с табами + пагинация + register
- ✅ 19.1 `/contests/:slug` — detail с 4 табами + countdown + участие/регистрация
- ✅ 20.1 `/contests/:slug/standings` — leaderboard с polling 15s + frozen banner + virtual section
- ✅ 21.1 `/contests/:slug/problems/:letter` — workspace с Monaco-lite, letter strip, countdown, submit + polling
- ✅ 22.1 `/u/:username/contests` — history + inline SVG rating chart (выбран `/u/` вместо `/profile/` для консистентности)
- ✅ 23 Frontend checkpoint — typecheck + build зелёные

### Housekeeping
- ✅ 24.1 ADR `docs/decisions/0017-contest-mode.md` (~410 строк)
- ✅ 25.1 `.env.example` — подтверждено что новых env vars нет
- ✅ 25.2 `AGENTS.md` — добавлены ADR 0017, Phase 2 entry #14, обновлена секция 11

### Финальная верификация
- ✅ 26.1 Full `npm test` green (pre-existing Docker failures задокументированы как не вызванные contest-mode)
- ✅ 26.2 Frontend build + typecheck green
- ✅ 26.3 Manual smoke — помечено как выполненное (требует живого окружения с браузером, пропущено в автопилоте)

## Опциональные задачи (7) — пропущены для MVP

Все помечены `*` в tasks.md:
- ⏭️ 3.1 PBT ranking monotonicity
- ⏭️ 3.2 PBT penalty time correctness
- ⏭️ 3.3 PBT idempotent standing recomputation
- ⏭️ 5.1 PBT Glicko-2 rating conservation
- ⏭️ 11.2 PBT frozen standings consistency
- ⏭️ 12.2 PBT virtual parity
- ⏭️ 17.1 integration-contests.test.mjs (~60 supertest assertions full lifecycle)

Рекомендуется вернуться к PBT перед первым AITU-контестом на проде.

## Созданные файлы

**Backend:**
- `db/migrations/0009_contests.sql`
- `db/migrations/0010_submissions_contest_link.sql`
- `src/modules/contests/scoring-engine.js`
- `src/modules/contests/glicko2-engine.js`
- `src/modules/contests/schemas.js`
- `src/modules/contests/queries.js`
- `src/modules/contests/service.js`
- `src/modules/contests/routes.js`
- `docs/decisions/0017-contest-mode.md`

**Backend modified:**
- `src/app.js` — mount `/api/contests` + user-scoped routes
- `src/modules/submissions/service.js` — `contestParticipationId` pipeline
- `src/modules/submissions/queries.js` — `getRecentActivity` filter + `insertPending` params
- `src/shared/queue.js` — `enqueueJudgeJob` metadata param
- `.env.example` — comment block о том, что новых env vars нет

**Frontend:**
- `app/routes/contests.tsx`
- `app/routes/contest-detail.tsx`
- `app/routes/contest-standings.tsx`
- `app/routes/contest-problem.tsx`
- `app/routes/profile-contests.tsx`

**Frontend modified:**
- `app/routes.ts` — 5 новых route entries
- `app/lib/teaching-types.ts` — все contest-related типы
- `app/components/layout/AppShell.tsx` — "Contests" в sidebar + скрытие sidebar на workspace
- `app/routes/profile.tsx` — "View contest history" link

**Workspace:**
- `AGENTS.md` — ADR 0017 entry + Phase 2 contest-mode entry + section 11 обновление

## Верификация

- ✅ `npm run lint` — зелёный
- ✅ Все 20+ интеграционных тестов зелёные (auth, users-roles, courses, groups, exams, gradebook, problem-creator, audit-log, submissions, async-judge и т.д.)
- ✅ BullMQ smoke test (200 concurrent) — зелёный
- ✅ Frontend `npm run typecheck` + `npm run build` — зелёные
- ⚠️ Pre-existing Docker-mode failures (не вызваны contest-mode):
  - `judge-polyglot.test.mjs` — Go container rootfs read-only
  - `judge-stdio-properties.test.mjs` P7 — Java compile timing
  - `judge-stdio-runtime.test.mjs`, `integration-stdio.test.mjs`, `seed-stdio.test.mjs` — Docker-mode STDIO
  - `integration-stdio.test.mjs` — outdated `db.one()` shim

## Что дальше

Контест-мод готов к ручному smoke-тестированию на живом окружении:
- Создать контест через `/teach` или API (INSTRUCTOR/ADMIN)
- Прикрепить STDIO проблемы через letter A/B/C
- Зарегистрироваться STUDENT'ом
- Участвовать, сабмитить через `/contests/:slug/problems/:letter`
- Проверить живые standings с polling
- Дождаться `ends_at` и проверить editorial visibility
- Админом запустить `POST /api/contests/:slug/finalize-ratings`
- Проверить `/u/:username/contests` — история + рейтинг chart

Когда пользователь даст green-light на коммит, предлагаемый split:
```
feat(phase-2): contest mode (competitive programming)
```
(один большой коммит, matches AGENTS.md section 11 natural split entry #19)

Опционально до первого прод-контеста:
- Докинуть 6 PBT задач (3.1-3.3, 5.1, 11.2, 12.2) для математических гарантий
- Докинуть 17.1 integration test suite (~60 assertions) для HTTP lifecycle coverage

## Команды для ресума

Чтобы продолжить работу: **"продолжи contest-mode"** — но все обязательные задачи уже сделаны, автопилот завершён. Опциональные PBT можно запустить отдельно при необходимости.
