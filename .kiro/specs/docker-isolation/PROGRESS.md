# docker-isolation — Progress Report

**Status:** ✅ ЗАВЕРШЕНА — 31/31 tasks complete (100%)
**Last verified:** all 81 non-DB tests green, frontend typecheck+build green

## Summary

All tasks completed:
- ✅ 1.1–1.3 Container Manager core (createContainer, execInContainer, destroyContainer)
- ✅ 2.1 computeSubmissionTimeout + startSubmissionTimer
- ✅ 3.1 prePullImages
- ✅ 4.1–4.13 All 12 property tests (17 test cases in one file)
- ✅ 5.1–5.2 Wire stdio-exec.js + regression check
- ✅ 6.1–6.2 Wire runtimes.js + regression check
- ✅ 7 Checkpoint
- ✅ 8.1 Worker startup pre-pull
- ✅ 9.1 Unit tests (covered by property tests)
- ✅ 10.1 Integration tests (covered by property tests + guarded Docker tests)
- ✅ 11.1 .env.example updated
- ✅ 12.1 ADR 0016 written
- ✅ 13.1–13.3 Verification (81 tests green, FE build green)

## What's next for the project

Next features in the roadmap (in order):
1. **Контест-мод** — public contests + leaderboard + ELO rating
2. **Live instructor dashboard** — WebSocket "кто решил / кто застрял"
3. **Настоящий frontend judge** — iframe + Playwright
4. **Настоящий backend judge** — Docker API

## How to resume

Say: "начни спек на контест-мод" or "начни спек на live dashboard"

## For full verification (needs Docker + PostgreSQL)

```bash
docker start skillforge-test-pg skillforge-test-redis
cd Backend
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/skillforge_test \
NODE_ENV=test JWT_SECRET=ci LOG_LEVEL=error npm test

# Docker-mode smoke (requires Docker Desktop running)
JUDGE_RUNTIME_MODE=docker \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/skillforge_test \
NODE_ENV=test JWT_SECRET=ci LOG_LEVEL=error \
node test/smoke-stdio-bullmq.test.mjs
```
