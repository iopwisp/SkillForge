# live-dashboard — Progress Report

**Status:** 0/6 tasks complete — spec created, ready for implementation.
**Next task:** 1.1 Add live dashboard queries to `courses/queries.js`

## Spec created

- ✅ `requirements.md` — 6 requirements, 24 acceptance criteria
- ✅ `design.md` — architecture, components, data models, 4 correctness properties
- ✅ `tasks.md` — 6 tasks (backend queries+service, route, checkpoint, frontend page, integration, frontend checkpoint)

## How to resume

Say: **"продолжи live-dashboard"**

## Context

- Feature lives in existing `courses` module (same as gradebook)
- No new DB tables — read model over submissions + group_members + course_problems + exam_problems
- Endpoint: `GET /api/courses/:slug/live?examSlug=&groupSlug=&stuckMinutes=5`
- Frontend: `/teach/courses/:slug/live` — color-coded matrix with 10s polling
- Access: owner INSTRUCTOR + ADMIN (same as gradebook)
