/**
 * SQL for the contests module.
 *
 * Owns: contests, contest_problems, contest_registrations,
 * contest_participations, contest_submissions, contest_ratings,
 * contest_rating_changes.
 *
 * No cross-module query imports (ADR 0003). Cross-module reads
 * (problems, users, submissions) are done via JOINs from owned tables
 * or through the respective module's service layer.
 *
 * A single read-only "view" query is exposed against the `users` table
 * — `findUserIdByUsername` — following the same pragma used in
 * `groups/queries.js` and `users/queries.js`. It lets the service
 * resolve a URL-path username (`/api/users/:username/contests`) into a
 * user id without introducing a circular dependency with users.service.
 * Writes to `users` still flow through users.service.
 */
import { db } from '../../shared/db.js';

/* ─── cross-module read helpers ─────────────────────────────────────────── */

export const findUserIdByUsername = async (username, executor = db) => {
  const row = await executor.maybeOne(
    `SELECT id FROM users WHERE username = $1`, [username],
  );
  return row?.id ?? null;
};

/* ─── contests ──────────────────────────────────────────────────────────── */

export async function insertContest(
  { slug, title, description, startsAt, endsAt, freezeMinutes, isPublic },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO contests (slug, title, description, starts_at, ends_at, freeze_minutes, is_public)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, slug
  `, [slug, title, description ?? null, startsAt, endsAt, freezeMinutes, isPublic]);
}

export const findContestBySlug = (slug, executor = db) =>
  executor.maybeOne(`
    SELECT id, slug, title, description, starts_at, ends_at,
           freeze_minutes, is_public, editorial, created_at
    FROM contests
    WHERE slug = $1
  `, [slug]);

export async function updateContest(contestId, fields, executor = db) {
  const cols = [];
  const args = [];
  const addCol = (name, value) => {
    cols.push(`${name} = $${args.length + 1}`);
    args.push(value);
  };

  if (fields.title !== undefined) addCol('title', fields.title);
  if (fields.description !== undefined) addCol('description', fields.description);
  if (fields.startsAt !== undefined) addCol('starts_at', fields.startsAt);
  if (fields.endsAt !== undefined) addCol('ends_at', fields.endsAt);
  if (fields.freezeMinutes !== undefined) addCol('freeze_minutes', fields.freezeMinutes);
  if (fields.isPublic !== undefined) addCol('is_public', fields.isPublic);
  if (fields.editorial !== undefined) addCol('editorial', fields.editorial);
  if (cols.length === 0) return;

  args.push(contestId);
  await executor.none(
    `UPDATE contests SET ${cols.join(', ')} WHERE id = $${args.length}`,
    args,
  );
}

export const deleteContest = (contestId, executor = db) =>
  executor.none(`DELETE FROM contests WHERE id = $1`, [contestId]);

export async function listContests({ limit, offset, status }, executor = db) {
  const conditions = [];
  const args = [];

  if (status === 'upcoming') {
    conditions.push(`NOW() < starts_at`);
  } else if (status === 'running') {
    conditions.push(`NOW() >= starts_at AND NOW() < ends_at`);
  } else if (status === 'finished') {
    conditions.push(`NOW() >= ends_at`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = await executor.maybeOne(`
    SELECT COUNT(*)::int AS total FROM contests ${whereSql}
  `, args);

  const rows = await executor.many(`
    SELECT
      c.id, c.slug, c.title, c.description, c.starts_at, c.ends_at,
      c.freeze_minutes, c.is_public, c.created_at,
      CASE
        WHEN NOW() < c.starts_at THEN 'upcoming'
        WHEN NOW() >= c.starts_at AND NOW() < c.ends_at THEN 'running'
        ELSE 'finished'
      END AS status,
      (SELECT COUNT(*)::int FROM contest_registrations cr WHERE cr.contest_id = c.id) AS participant_count
    FROM contests c
    ${whereSql}
    ORDER BY c.starts_at DESC
    LIMIT $${args.length + 1} OFFSET $${args.length + 2}
  `, [...args, limit, offset]);

  return { rows, total: totalRow?.total ?? 0 };
}

/* ─── contest_problems ──────────────────────────────────────────────────── */

export const attachProblem = ({ contestId, problemId, letter }, executor = db) =>
  executor.none(`
    INSERT INTO contest_problems (contest_id, problem_id, letter)
    VALUES ($1, $2, $3)
  `, [contestId, problemId, letter]);

export const detachProblem = (contestId, letter, executor = db) =>
  executor.none(`
    DELETE FROM contest_problems
    WHERE contest_id = $1 AND letter = $2
  `, [contestId, letter]);

export const listContestProblems = (contestId, executor = db) =>
  executor.many(`
    SELECT cp.problem_id, cp.letter, p.slug, p.title, p.difficulty, p.problem_type
    FROM contest_problems cp
    JOIN problems p ON p.id = cp.problem_id
    WHERE cp.contest_id = $1
    ORDER BY cp.letter ASC
  `, [contestId]);

export const findContestProblemByLetter = (contestId, letter, executor = db) =>
  executor.maybeOne(`
    SELECT cp.contest_id, cp.problem_id, cp.letter, p.slug, p.title, p.difficulty, p.problem_type
    FROM contest_problems cp
    JOIN problems p ON p.id = cp.problem_id
    WHERE cp.contest_id = $1 AND cp.letter = $2
  `, [contestId, letter]);

/* ─── contest_registrations ─────────────────────────────────────────────── */

export const insertRegistration = (contestId, userId, executor = db) =>
  executor.none(`
    INSERT INTO contest_registrations (contest_id, user_id)
    VALUES ($1, $2)
  `, [contestId, userId]);

export const deleteRegistration = (contestId, userId, executor = db) =>
  executor.none(`
    DELETE FROM contest_registrations
    WHERE contest_id = $1 AND user_id = $2
  `, [contestId, userId]);

export const findRegistration = (contestId, userId, executor = db) =>
  executor.maybeOne(`
    SELECT contest_id, user_id, registered_at
    FROM contest_registrations
    WHERE contest_id = $1 AND user_id = $2
  `, [contestId, userId]);

export async function countRegistrations(contestId, executor = db) {
  const row = await executor.maybeOne(`
    SELECT COUNT(*)::int AS count
    FROM contest_registrations
    WHERE contest_id = $1
  `, [contestId]);
  return row?.count ?? 0;
}

/* ─── contest_participations ────────────────────────────────────────────── */

export async function insertParticipation(
  { contestId, userId, isVirtual, personalDeadline },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO contest_participations (contest_id, user_id, is_virtual, personal_deadline)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [contestId, userId, isVirtual, personalDeadline]);
}

export const findActiveParticipation = (contestId, userId, executor = db) =>
  executor.maybeOne(`
    SELECT id, contest_id, user_id, started_at, is_virtual, personal_deadline
    FROM contest_participations
    WHERE contest_id = $1 AND user_id = $2 AND is_virtual = false
  `, [contestId, userId]);

/**
 * Most recently started virtual participation for (contest, user). There
 * may be multiple (the partial UNIQUE index on live participations does
 * not cover virtual), so we return the newest so the service can use it
 * as the "active" one for submit checks.
 */
export const findLatestVirtualParticipation = (contestId, userId, executor = db) =>
  executor.maybeOne(`
    SELECT id, contest_id, user_id, started_at, is_virtual, personal_deadline
    FROM contest_participations
    WHERE contest_id = $1 AND user_id = $2 AND is_virtual = true
    ORDER BY started_at DESC
    LIMIT 1
  `, [contestId, userId]);

export const findParticipationById = (id, executor = db) =>
  executor.maybeOne(`
    SELECT id, contest_id, user_id, started_at, is_virtual, personal_deadline
    FROM contest_participations
    WHERE id = $1
  `, [id]);

export const listParticipations = (contestId, executor = db) =>
  executor.many(`
    SELECT cp.id, cp.contest_id, cp.user_id, cp.started_at, cp.is_virtual,
           cp.personal_deadline, u.username
    FROM contest_participations cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.contest_id = $1
    ORDER BY cp.started_at ASC
  `, [contestId]);

/* ─── contest_submissions ───────────────────────────────────────────────── */

export async function insertContestSubmission(
  { participationId, problemId, submissionId },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO contest_submissions (participation_id, problem_id, submission_id)
    VALUES ($1, $2, $3)
    RETURNING id
  `, [participationId, problemId, submissionId]);
}

export const findSubmissionsByParticipation = (participationId, executor = db) =>
  executor.many(`
    SELECT cs.id, cs.participation_id, cs.problem_id, cs.submission_id, cs.created_at,
           s.status, s.language, s.runtime_ms, s.memory_kb
    FROM contest_submissions cs
    JOIN submissions s ON s.id = cs.submission_id
    WHERE cs.participation_id = $1
    ORDER BY cs.created_at ASC
  `, [participationId]);

export const findAllContestSubmissions = (contestId, executor = db) =>
  executor.many(`
    SELECT cs.id, cs.participation_id, cs.problem_id, cs.submission_id, cs.created_at,
           s.status, s.created_at AS submitted_at,
           cp.started_at AS participation_started_at
    FROM contest_submissions cs
    JOIN submissions s ON s.id = cs.submission_id
    JOIN contest_participations cp ON cp.id = cs.participation_id
    WHERE cp.contest_id = $1
    ORDER BY cs.created_at ASC
  `, [contestId]);

/* ─── contest_ratings ───────────────────────────────────────────────────── */

export const findRating = (userId, executor = db) =>
  executor.maybeOne(`
    SELECT user_id, rating, rating_deviation, volatility, contests_played, last_contest_at
    FROM contest_ratings
    WHERE user_id = $1
  `, [userId]);

export const upsertRating = (
  { userId, rating, rd, volatility, contestsPlayed, lastContestAt },
  executor = db,
) =>
  executor.none(`
    INSERT INTO contest_ratings (user_id, rating, rating_deviation, volatility, contests_played, last_contest_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      rating = EXCLUDED.rating,
      rating_deviation = EXCLUDED.rating_deviation,
      volatility = EXCLUDED.volatility,
      contests_played = EXCLUDED.contests_played,
      last_contest_at = EXCLUDED.last_contest_at
  `, [userId, rating, rd, volatility, contestsPlayed, lastContestAt]);

/* ─── contest_rating_changes ────────────────────────────────────────────── */

/**
 * Batch insert rating changes for a contest. `changes` is an array of
 * { contestId, userId, oldRating, newRating, oldRd, newRd, rank, delta }.
 */
export async function insertRatingChanges(changes, executor = db) {
  if (!changes.length) return;

  const values = [];
  const args = [];
  for (const c of changes) {
    const base = args.length;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
    args.push(c.contestId, c.userId, c.oldRating, c.newRating, c.oldRd, c.newRd, c.rank, c.delta);
  }

  await executor.none(`
    INSERT INTO contest_rating_changes (contest_id, user_id, old_rating, new_rating, old_rd, new_rd, rank, delta)
    VALUES ${values.join(', ')}
  `, args);
}

export const findRatingChangesByUser = (userId, executor = db) =>
  executor.many(`
    SELECT rc.id, rc.contest_id, rc.user_id, rc.old_rating, rc.new_rating,
           rc.old_rd, rc.new_rd, rc.rank, rc.delta,
           c.slug AS contest_slug, c.title AS contest_title, c.ends_at AS contest_date
    FROM contest_rating_changes rc
    JOIN contests c ON c.id = rc.contest_id
    WHERE rc.user_id = $1
    ORDER BY c.ends_at ASC
  `, [userId]);

export const findRatingChangesByContest = (contestId, executor = db) =>
  executor.many(`
    SELECT rc.id, rc.contest_id, rc.user_id, rc.old_rating, rc.new_rating,
           rc.old_rd, rc.new_rd, rc.rank, rc.delta,
           u.username
    FROM contest_rating_changes rc
    JOIN users u ON u.id = rc.user_id
    WHERE rc.contest_id = $1
    ORDER BY rc.rank ASC
  `, [contestId]);
/* ─── user contest history ──────────────────────────────────────────────── */

/**
 * List contests a user has participated in (live or virtual), with the
 * full contest metadata plus per-participation submission roll-up. The
 * service layer combines this with the scoring engine to compute rank.
 *
 * Returns one row per participation.
 */
export const listParticipationsByUser = (userId, executor = db) =>
  executor.many(`
    SELECT
      cp.id AS participation_id, cp.contest_id, cp.user_id,
      cp.started_at, cp.is_virtual, cp.personal_deadline,
      c.slug AS contest_slug, c.title AS contest_title,
      c.starts_at, c.ends_at, c.freeze_minutes
    FROM contest_participations cp
    JOIN contests c ON c.id = cp.contest_id
    WHERE cp.user_id = $1
    ORDER BY c.ends_at DESC
  `, [userId]);
