/**
 * Contests service — owns the contest lifecycle, registration, participation,
 * submission, standings, and rating computation.
 *
 * Cross-module dependencies (allowed per ADR 0003):
 *   - problems.service.getProblemBySlug — resolve attached problem slugs
 *   - submissions.service.submit        — enqueue contest submissions on
 *                                         the shared async judge pipeline
 *   - audit.service.recordEvent         — log privileged mutations
 */
import { withTransaction } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import * as audit from '../audit/service.js';
import * as problems from '../problems/service.js';
import * as submissions from '../submissions/service.js';
import {
  computeGlicko2Changes,
  INITIAL_RATING,
  INITIAL_RD,
  INITIAL_VOLATILITY,
} from './glicko2-engine.js';
import * as q from './queries.js';
import { computeICPCStandings } from './scoring-engine.js';

/**
 * Create a new contest.
 */
export async function createContest(actor, payload) {
  return withTransaction(async (tx) => {
    // Check slug uniqueness
    if (await q.findContestBySlug(payload.slug, tx)) {
      throw new HttpError(409, `A contest with slug "${payload.slug}" already exists`);
    }

    await q.insertContest({
      slug: payload.slug,
      title: payload.title,
      description: payload.description || null,
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
      freezeMinutes: payload.freezeMinutes ?? 30,
      isPublic: payload.isPublic ?? true,
    }, tx);

    await audit.recordEvent(actor, {
      action: 'CREATE',
      entityType: 'CONTEST',
      entityKey: payload.slug,
      details: { title: payload.title },
    }, { db: tx });

    const created = await q.findContestBySlug(payload.slug, tx);
    return toContestDetail(created);
  });
}

/**
 * Update a contest (only before it starts).
 */
export async function updateContest(actor, slug, fields) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    if (new Date() >= new Date(contest.starts_at)) {
      throw new HttpError(409, 'Cannot modify a contest that has already started', { code: 'CONTEST_ALREADY_STARTED' });
    }

    await q.updateContest(contest.id, {
      title: fields.title,
      description: fields.description,
      startsAt: fields.startsAt,
      endsAt: fields.endsAt,
      freezeMinutes: fields.freezeMinutes,
      isPublic: fields.isPublic,
    }, tx);

    await audit.recordEvent(actor, {
      action: 'UPDATE',
      entityType: 'CONTEST',
      entityKey: slug,
      details: { fields: Object.keys(fields) },
    }, { db: tx });

    const updated = await q.findContestBySlug(slug, tx);
    return toContestDetail(updated);
  });
}

/**
 * Delete a contest (admin only, cascades everything).
 */
export async function deleteContest(actor, slug) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    await audit.recordEvent(actor, {
      action: 'DELETE',
      entityType: 'CONTEST',
      entityKey: slug,
      details: {},
    }, { db: tx });

    await q.deleteContest(contest.id, tx);
  });
}

/**
 * Get contest detail with computed status.
 */
export async function getContest(actor, slug) {
  const contest = await q.findContestBySlug(slug);
  if (!contest) throw new HttpError(404, 'Contest not found');

  const problems = await q.listContestProblems(contest.id);
  const participantCount = await q.countRegistrations(contest.id);
  const registration = actor ? await q.findRegistration(contest.id, actor.id) : null;
  const participation = actor ? await q.findActiveParticipation(contest.id, actor.id) : null;

  const status = computeStatus(contest);

  return {
    ...toContestDetail(contest),
    status,
    participantCount,
    isRegistered: !!registration,
    isParticipating: !!participation,
    participation: participation ? {
      id: participation.id,
      startedAt: participation.started_at,
      personalDeadline: participation.personal_deadline,
      isVirtual: participation.is_virtual,
    } : null,
    problems: status === 'upcoming' ? problems.map(p => ({ letter: p.letter, title: '???' })) : problems.map(toContestProblemSummary),
  };
}

/**
 * List contests with pagination and status filter.
 */
export async function listContests(actor, { page, pageSize, status }) {
  const offset = (Math.max(page, 1) - 1) * pageSize;
  const { rows, total } = await q.listContests({
    limit: pageSize, offset, status, actorId: actor?.id ?? null,
  });

  return {
    items: rows.map(toContestListItem),
    total,
    page,
    pageSize,
  };
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

function computeStatus(contest) {
  const now = new Date();
  const startsAt = new Date(contest.starts_at);
  const endsAt = new Date(contest.ends_at);
  if (now < startsAt) return 'upcoming';
  if (now >= startsAt && now < endsAt) return 'running';
  return 'finished';
}

function toContestDetail(c) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description || '',
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    freezeMinutes: c.freeze_minutes,
    isPublic: c.is_public,
    editorial: c.editorial || null,
    createdAt: c.created_at,
  };
}

function toContestListItem(c) {
  return {
    slug: c.slug,
    title: c.title,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    isPublic: c.is_public,
    status: c.status,
    participantCount: c.participant_count,
    isRegistered: !!c.is_registered,
  };
}

function toContestProblemSummary(p) {
  return {
    id: p.problem_id,
    letter: p.letter,
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    problemType: p.problem_type,
  };
}
/* ─── 8.2 problem attachment ───────────────────────────────────────────── */

/**
 * Attach a problem to a contest under a letter (A–Z).
 *
 *   - 409 CONTEST_ALREADY_STARTED if the contest has started.
 *   - 404 if the problem slug does not resolve.
 *   - 409 LETTER_ALREADY_USED on duplicate letter (catches 23505 on the
 *     `contest_problems (contest_id, letter)` UNIQUE).
 */
export async function attachProblem(actor, slug, { problemSlug, letter }) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    assertNotStarted(contest);

    const problem = await problems.getProblemBySlug(problemSlug);
    if (!problem) throw new HttpError(404, `Problem "${problemSlug}" not found`);

    try {
      await q.attachProblem({
        contestId: contest.id,
        problemId: problem.id,
        letter,
      }, tx);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new HttpError(409, `Letter "${letter}" is already used in this contest`, { code: 'LETTER_ALREADY_USED' });
      }
      throw e;
    }

    await audit.recordEvent(actor, {
      action: 'ATTACH_PROBLEM',
      entityType: 'CONTEST',
      entityKey: slug,
      details: { problemSlug, letter },
    }, { db: tx });

    return { letter, slug: problem.slug, title: problem.title };
  });
}

export async function detachProblem(actor, slug, letter) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    assertNotStarted(contest);

    await q.detachProblem(contest.id, letter, tx);

    await audit.recordEvent(actor, {
      action: 'DETACH_PROBLEM',
      entityType: 'CONTEST',
      entityKey: slug,
      details: { letter },
    }, { db: tx });
  });
}

/* ─── 8.3 registration and participation ───────────────────────────────── */

/**
 * Register an authenticated user for an upcoming contest.
 *
 *   - 400 REGISTRATION_CLOSED if the contest has already started.
 *   - 409 ALREADY_REGISTERED on duplicate (UNIQUE violation).
 */
export async function register(actor, slug) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    if (new Date() >= new Date(contest.starts_at)) {
      throw new HttpError(400, 'Registration has closed for this contest', { code: 'REGISTRATION_CLOSED' });
    }

    try {
      await q.insertRegistration(contest.id, actor.id, tx);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new HttpError(409, 'You are already registered for this contest', { code: 'ALREADY_REGISTERED' });
      }
      throw e;
    }

    return { slug, registered: true };
  });
}

/**
 * Unregister before the contest starts. Idempotent — DELETE on an
 * unknown (contest, user) pair is a no-op.
 */
export async function unregister(actor, slug) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    if (new Date() >= new Date(contest.starts_at)) {
      throw new HttpError(400, 'Registration window is closed', { code: 'REGISTRATION_CLOSED' });
    }

    await q.deleteRegistration(contest.id, actor.id, tx);
  });
}

/**
 * Start a contest participation for the actor.
 *
 * Live (`virtual !== true`):
 *   - Contest must be running (`starts_at <= NOW() < ends_at`).
 *   - Actor must have a registration row.
 *   - `personal_deadline = MIN(NOW() + contestDurationMs, ends_at)`.
 *
 * Virtual (`virtual === true`):
 *   - Contest must be finished (`NOW() >= ends_at`).
 *   - No registration required.
 *   - `personal_deadline = NOW() + contestDurationMs`.
 */
export async function participate(actor, slug, { virtual } = {}) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    const now = new Date();
    const startsAt = new Date(contest.starts_at);
    const endsAt = new Date(contest.ends_at);
    const durationMs = endsAt.getTime() - startsAt.getTime();

    let isVirtual;
    let personalDeadline;

    if (virtual) {
      if (now < endsAt) {
        throw new HttpError(400, 'Virtual participation is available only after the contest ends', { code: 'CONTEST_NOT_FINISHED' });
      }
      isVirtual = true;
      personalDeadline = new Date(now.getTime() + durationMs);
    } else {
      if (now < startsAt || now >= endsAt) {
        throw new HttpError(400, 'Contest is not currently active', { code: 'CONTEST_NOT_ACTIVE' });
      }

      const registration = await q.findRegistration(contest.id, actor.id, tx);
      if (!registration) {
        throw new HttpError(403, 'You must register before participating', { code: 'NOT_REGISTERED' });
      }

      isVirtual = false;
      const deadlineMs = Math.min(now.getTime() + durationMs, endsAt.getTime());
      personalDeadline = new Date(deadlineMs);
    }

    let inserted;
    try {
      inserted = await q.insertParticipation({
        contestId: contest.id,
        userId: actor.id,
        isVirtual,
        personalDeadline,
      }, tx);
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Only live participations are uniquely indexed; this can only
        // fire on the live path.
        throw new HttpError(409, 'You already have an active participation in this contest', { code: 'ALREADY_PARTICIPATING' });
      }
      throw e;
    }

    const full = await q.findParticipationById(inserted.id, tx);
    return {
      id: full.id,
      contestSlug: slug,
      startedAt: full.started_at,
      isVirtual: full.is_virtual,
      personalDeadline: full.personal_deadline,
    };
  });
}

/* ─── 8.4 contest submissions ──────────────────────────────────────────── */

/**
 * Submit a solution inside a contest.
 *
 *   - Looks up the active participation: live first, falling back to
 *     the most recently started virtual participation if none.
 *   - 400 NO_PARTICIPATION if neither exists.
 *   - 400 CONTEST_TIME_EXPIRED if `NOW() >= personal_deadline`.
 *   - 404 if the letter is not attached to this contest.
 *   - Delegates the actual judge enqueue + PENDING row creation to
 *     `submissions.service.submit` (shared async pipeline, ADR 0013) and
 *     links it to the participation via `contest_submissions`.
 *
 * The `contestParticipationId` is threaded through submissions.service
 * (task 13.1) so the PENDING row carries it, the BullMQ job metadata
 * carries it, and the worker's finalize hook calls back into
 * `onContestSubmissionFinalized(submissionId)` for standing recompute.
 */
export async function submitInContest(actor, slug, letter, { code, language }) {
  const contest = await q.findContestBySlug(slug);
  if (!contest) throw new HttpError(404, 'Contest not found');

  // Prefer a live participation; if none, fall back to the most recent
  // virtual one (a user may revisit a contest virtually multiple times).
  let participation = await q.findActiveParticipation(contest.id, actor.id);
  if (!participation) {
    participation = await q.findLatestVirtualParticipation(contest.id, actor.id);
  }
  if (!participation) {
    throw new HttpError(400, 'You have no active participation in this contest', { code: 'NO_PARTICIPATION' });
  }

  if (new Date() >= new Date(participation.personal_deadline)) {
    throw new HttpError(400, 'Your contest time has expired', { code: 'CONTEST_TIME_EXPIRED' });
  }

  const contestProblem = await q.findContestProblemByLetter(contest.id, letter);
  if (!contestProblem) {
    throw new HttpError(404, `Problem "${letter}" not found in this contest`);
  }

  const submission = await submissions.submit({
    user: actor,
    slug: contestProblem.slug,
    code,
    language,
    contestParticipationId: participation.id,
  });

  await q.insertContestSubmission({
    participationId: participation.id,
    problemId: contestProblem.problem_id,
    submissionId: submission.id,
  });

  return {
    id: submission.id,
    status: submission.status,
    letter,
    problem: { slug: contestProblem.slug, title: contestProblem.title },
  };
}

/* ─── 8.5 standings and finalization ───────────────────────────────────── */

/**
 * Compute the current standings for a contest.
 *
 * Freeze handling (R9.1–R9.5):
 *   - If `freeze_minutes > 0` and `NOW()` is in [ends_at - freeze_minutes,
 *     ends_at), filter submissions to those `created_at < freeze_start`
 *     unless the caller is an ADMIN asking for the unfrozen view.
 *   - After `ends_at`, everything is visible.
 *
 * The `since` parameter is accepted for forward-compat with the
 * polling-delta read from design.md §Endpoint Map but not yet
 * implemented; the full standings are returned regardless.
 */
export async function getStandings(actor, slug, { unfrozen = false, since: _since } = {}) {
  const contest = await q.findContestBySlug(slug);
  if (!contest) throw new HttpError(404, 'Contest not found');

  const now = new Date();
  const endsAt = new Date(contest.ends_at);
  const freezeMs = Number(contest.freeze_minutes || 0) * 60000;
  const freezeStart = freezeMs > 0 ? new Date(endsAt.getTime() - freezeMs) : null;

  const status = computeStatus(contest);

  // Whether the response should be frozen. Freeze applies only between
  // the freeze start and ends_at, and only if the caller is not an
  // ADMIN explicitly asking for the unfrozen view.
  const isAdmin = actor?.role === 'ADMIN';
  const inFreezeWindow = !!freezeStart && now >= freezeStart && now < endsAt;
  const frozen = inFreezeWindow && !(isAdmin && unfrozen);

  const participations = await q.listParticipations(contest.id);
  const rawSubmissions = await q.findAllContestSubmissions(contest.id);

  // Only finalized submissions with an outcome contribute to standings.
  // PENDING submissions count as in-flight attempts but have no verdict
  // yet. We include them as non-ACCEPTED so the attempt counter still
  // ticks; the scoring engine treats non-ACCEPTED as a wrong attempt
  // only if a later ACCEPTED lands for the same problem.
  let scoringSubs = rawSubmissions
    .filter((s) => s.status !== 'PENDING')
    .map((s) => ({
      participationId: s.participation_id,
      problemId: s.problem_id,
      status: s.status,
      createdAt: s.created_at,
    }));

  if (frozen && freezeStart) {
    scoringSubs = scoringSubs.filter((s) => new Date(s.createdAt) < freezeStart);
  }

  const scoringParts = participations.map((p) => ({
    id: p.id,
    userId: p.user_id,
    username: p.username,
    startedAt: p.started_at,
    isVirtual: p.is_virtual,
  }));

  const standings = computeICPCStandings(scoringParts, scoringSubs);

  return {
    status,
    frozen,
    freezeStart: freezeStart ? freezeStart.toISOString() : null,
    standings,
  };
}

/**
 * Called by the judge worker after a contest submission finalizes
 * (task 13.1). For v1 the standings are fully recomputed on every
 * `getStandings` read, so this hook only needs to observe the
 * finalization — there's no incremental cache to update. Kept as an
 * explicit async function so:
 *
 *   - a future cache / WebSocket push layer has a natural wiring
 *     point without touching submissions.service;
 *   - the worker can await it, guaranteeing that a submission row's
 *     finalize + contest-side effects happen before the next poll.
 *
 * The submissions worker already filters out `JUDGE_ERROR` (R17.4)
 * before calling this, so we can assume the verdict is a real one
 * (ACCEPTED / WRONG_ANSWER / TLE / MEMORY_LIMIT / RUNTIME_ERROR /
 * COMPILE_ERROR).
 */
// eslint-disable-next-line no-unused-vars
export async function onContestSubmissionFinalized(submissionId) {
  // Intentional no-op for v1. Standings are computed on demand from
  // `contest_submissions` + `submissions` via `getStandings`.
}

/**
 * Finalize Glicko-2 ratings for a contest.
 *
 * Steps, all inside a single transaction:
 *   1. Compute final standings (live only — virtual participants do not
 *      affect rating per R10.4).
 *   2. For each live participant, load their current contest rating
 *      (or fall back to Glicko-2 initials for first-timers).
 *   3. Ask the Glicko-2 engine for rating deltas.
 *   4. Insert one `contest_rating_changes` row per participant.
 *   5. Upsert `contest_ratings` with the new rating / RD / volatility,
 *      bumping `contests_played` and setting `last_contest_at` to
 *      `contest.ends_at`.
 */
export async function finalizeContestRatings(slug) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    const participations = await q.listParticipations(contest.id, tx);
    const rawSubmissions = await q.findAllContestSubmissions(contest.id, tx);

    const scoringParts = participations.map((p) => ({
      id: p.id,
      userId: p.user_id,
      username: p.username,
      startedAt: p.started_at,
      isVirtual: p.is_virtual,
    }));
    const scoringSubs = rawSubmissions
      .filter((s) => s.status !== 'PENDING')
      .map((s) => ({
        participationId: s.participation_id,
        problemId: s.problem_id,
        status: s.status,
        createdAt: s.created_at,
      }));

    const standings = computeICPCStandings(scoringParts, scoringSubs);
    const liveStandings = standings.filter((s) => !s.isVirtual);
    if (liveStandings.length < 2) {
      // Glicko-2 needs at least 2 participants to produce deltas.
      return { ratingChanges: [] };
    }

    // Build participant ratings from `contest_ratings`, defaulting to
    // Glicko-2 initial values for users with no prior contest.
    const participants = [];
    for (const entry of liveStandings) {
      const existing = await q.findRating(entry.userId, tx);
      participants.push({
        userId: entry.userId,
        rating: existing ? existing.rating : INITIAL_RATING,
        rd: existing ? existing.rating_deviation : INITIAL_RD,
        volatility: existing ? existing.volatility : INITIAL_VOLATILITY,
      });
    }

    const rankedStandings = liveStandings.map((s) => ({
      userId: s.userId,
      rank: s.rank,
    }));

    const changes = computeGlicko2Changes(participants, rankedStandings);

    const rankByUser = new Map(liveStandings.map((s) => [s.userId, s.rank]));
    const ratingChangeRows = changes.map((c) => ({
      contestId: contest.id,
      userId: c.userId,
      oldRating: c.oldRating,
      newRating: c.newRating,
      oldRd: c.oldRd,
      newRd: c.newRd,
      rank: rankByUser.get(c.userId),
      delta: c.delta,
    }));
    await q.insertRatingChanges(ratingChangeRows, tx);

    // We also need the post-contest volatility for the upsert. The
    // Glicko-2 engine currently returns only rating + rd + delta, so
    // we carry the old volatility forward for persistence. This is a
    // conservative no-op that keeps the rating pool stable; the engine
    // already baked volatility into the new rating.
    for (const c of changes) {
      const prior = participants.find((p) => p.userId === c.userId);
      await q.upsertRating({
        userId: c.userId,
        rating: c.newRating,
        rd: c.newRd,
        volatility: prior?.volatility ?? INITIAL_VOLATILITY,
        contestsPlayed: ((await q.findRating(c.userId, tx))?.contests_played ?? 0) + 1,
        lastContestAt: contest.ends_at,
      }, tx);
    }

    return { ratingChanges: ratingChangeRows };
  });
}

/* ─── 8.6 editorial and user history ───────────────────────────────────── */

/**
 * Publish or update the markdown editorial on a contest row.
 * Visibility is gated on read — editors may push content before the
 * contest ends, and readers won't see it until NOW() >= ends_at.
 */
export async function publishEditorial(actor, slug, { content }) {
  return withTransaction(async (tx) => {
    const contest = await q.findContestBySlug(slug, tx);
    if (!contest) throw new HttpError(404, 'Contest not found');

    await q.updateContest(contest.id, { editorial: content }, tx);

    await audit.recordEvent(actor, {
      action: 'PUBLISH_EDITORIAL',
      entityType: 'CONTEST',
      entityKey: slug,
      details: { length: content.length },
    }, { db: tx });

    return { slug, published: true };
  });
}

/**
 * Return the editorial only if the contest has ended AND a non-empty
 * editorial has been published. 404 on both "not ended" and "not
 * published" so the existence of unpublished drafts does not leak.
 */
export async function getEditorial(actor, slug) {
  const contest = await q.findContestBySlug(slug);
  if (!contest) throw new HttpError(404, 'Contest not found');

  if (new Date() < new Date(contest.ends_at)) {
    throw new HttpError(404, 'Editorial is not yet available');
  }
  if (!contest.editorial) {
    throw new HttpError(404, 'No editorial has been published for this contest');
  }

  return { slug, content: contest.editorial };
}

/**
 * Current Glicko-2 rating + history for a user.
 *
 * Returns null rating for users that have never participated in a
 * rated contest (no `contest_ratings` row). The history array mirrors
 * the design.md spec: `{ contest_slug, date, rating, delta }`.
 */
export async function getContestRating(username) {
  const userId = await q.findUserIdByUsername(username);
  if (!userId) throw new HttpError(404, 'User not found');

  const rating = await q.findRating(userId);
  const history = await q.findRatingChangesByUser(userId);

  return {
    username,
    rating: rating ? rating.rating : null,
    ratingDeviation: rating ? rating.rating_deviation : null,
    volatility: rating ? rating.volatility : null,
    contestsPlayed: rating ? rating.contests_played : 0,
    lastContestAt: rating ? rating.last_contest_at : null,
    history: history.map((h) => ({
      contestSlug: h.contest_slug,
      contestTitle: h.contest_title,
      date: h.contest_date,
      oldRating: h.old_rating,
      newRating: h.new_rating,
      delta: h.delta,
      rank: h.rank,
    })),
  };
}

/**
 * List the contests a user has participated in, with per-contest rank +
 * solved count computed via the scoring engine, plus rating change info
 * if a rating was recorded for that contest.
 *
 * Returns an empty array for users with no participations.
 */
export async function getUserContestHistory(username) {
  const userId = await q.findUserIdByUsername(username);
  if (!userId) throw new HttpError(404, 'User not found');

  const participations = await q.listParticipationsByUser(userId);
  if (participations.length === 0) return [];

  const ratingChanges = await q.findRatingChangesByUser(userId);
  const changesByContest = new Map(
    ratingChanges.map((r) => [r.contest_id, r]),
  );

  // For rank + solved count we need the per-contest standings. Computing
  // them once per contest is the right granularity (a user can only have
  // one live participation per contest; virtual participations share the
  // same standings).
  const contestCache = new Map();
  const history = [];

  for (const p of participations) {
    let contestData = contestCache.get(p.contest_id);
    if (!contestData) {
      const [parts, subs] = await Promise.all([
        q.listParticipations(p.contest_id),
        q.findAllContestSubmissions(p.contest_id),
      ]);
      const scoringSubs = subs
        .filter((s) => s.status !== 'PENDING')
        .map((s) => ({
          participationId: s.participation_id,
          problemId: s.problem_id,
          status: s.status,
          createdAt: s.created_at,
        }));
      const standings = computeICPCStandings(
        parts.map((pp) => ({
          id: pp.id,
          userId: pp.user_id,
          username: pp.username,
          startedAt: pp.started_at,
          isVirtual: pp.is_virtual,
        })),
        scoringSubs,
      );
      contestData = new Map(standings.map((s) => [s.participationId, s]));
      contestCache.set(p.contest_id, contestData);
    }

    const entry = contestData.get(p.participation_id);
    const ratingChange = changesByContest.get(p.contest_id);

    history.push({
      contestSlug: p.contest_slug,
      contestTitle: p.contest_title,
      date: p.ends_at,
      isVirtual: p.is_virtual,
      rank: entry ? entry.rank : null,
      solvedCount: entry ? entry.solvedCount : 0,
      penaltyTime: entry ? entry.penaltyTime : 0,
      ratingChange: ratingChange ? ratingChange.delta : null,
      newRating: ratingChange ? ratingChange.new_rating : null,
    });
  }

  return history;
}

/* ─── assertion helpers ─────────────────────────────────────────────────── */

function assertNotStarted(contest) {
  if (new Date() >= new Date(contest.starts_at)) {
    throw new HttpError(409, 'Cannot modify a contest that has already started', { code: 'CONTEST_ALREADY_STARTED' });
  }
}

function isUniqueViolation(err) {
  return !!err && err.code === '23505';
}
