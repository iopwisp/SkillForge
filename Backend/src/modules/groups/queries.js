/**
 * SQL for the groups module.
 *
 * Owns reads/writes for `groups` and `group_members`. Per ADR 0008 §
 * "Cross-module data flow" this file also holds a handful of read-only
 * "view" queries against tables that belong to other modules:
 *
 *   - `findCourseRefBySlug`  → reads `courses` to resolve slug → (id, owner).
 *     Lets groups.service do the "course exists + owner-or-ADMIN" check
 *     without pulling in courses.service (which would create a circular
 *     module dependency the day we narrow course visibility).
 *   - `findUserIdByUsername` → reads `users` to resolve a username supplied
 *     by an instructor adding a member to a group.
 *
 * These mirror the same pragma used in `users/queries.js` for its
 * dashboard joins. Writes to `users` / `courses` continue to flow through
 * those modules' services.
 */
import { db } from '../../shared/db.js';

/* ─── cross-module read helpers ─────────────────────────────────────────── */

export const findCourseRefBySlug = (slug, executor = db) =>
  executor.maybeOne(
    `SELECT id, owner_id FROM courses WHERE slug = $1`, [slug],
  );

export const findUserIdByUsername = async (username, executor = db) => {
  const row = await executor.maybeOne(
    `SELECT id FROM users WHERE username = $1`, [username],
  );
  return row?.id ?? null;
};

/* ─── groups ────────────────────────────────────────────────────────────── */

export const listGroupsForCourse = (courseId, executor = db) =>
  executor.many(`
    SELECT
      g.id, g.slug, g.title, g.created_at, g.updated_at,
      (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count
    FROM groups g
    WHERE g.course_id = $1
    ORDER BY g.slug ASC
  `, [courseId]);

export const listGroupsForCourseAndUser = (courseId, userId, executor = db) =>
  executor.many(`
    SELECT
      g.id, g.slug, g.title, g.created_at, g.updated_at,
      (SELECT COUNT(*)::int FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE g.course_id = $1 AND gm.user_id = $2
    ORDER BY g.slug ASC
  `, [courseId, userId]);

export const findGroupByCourseAndSlug = (courseId, groupSlug, executor = db) =>
  executor.maybeOne(`
    SELECT g.id, g.course_id, g.slug, g.title, g.created_at, g.updated_at
    FROM groups g
    WHERE g.course_id = $1 AND g.slug = $2
  `, [courseId, groupSlug]);

export async function insertGroup({ courseId, slug, title }, executor = db) {
  return executor.maybeOne(`
    INSERT INTO groups (course_id, slug, title)
    VALUES ($1, $2, $3)
    RETURNING id, course_id, slug, title, created_at, updated_at
  `, [courseId, slug, title]);
}

export async function updateGroup(groupId, fields, executor = db) {
  const cols = [];
  const args = [];
  if (fields.title !== undefined) { cols.push('title'); args.push(fields.title); }
  if (cols.length === 0) return;
  const setSql = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  args.push(groupId);
  await executor.none(
    `UPDATE groups SET ${setSql}, updated_at = NOW() WHERE id = $${args.length}`,
    args,
  );
}

export const deleteGroup = (groupId, executor = db) =>
  executor.none(`DELETE FROM groups WHERE id = $1`, [groupId]);

/* ─── group_members ─────────────────────────────────────────────────────── */

export const listMembers = (groupId, executor = db) =>
  executor.many(`
    SELECT u.id, u.username, u.full_name, u.avatar_url, u.role, gm.joined_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = $1
    ORDER BY u.username ASC
  `, [groupId]);

export const isMember = async (groupId, userId, executor = db) => {
  const row = await executor.maybeOne(
    `SELECT 1 AS one FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  return !!row;
};

export async function addMember(groupId, userId, executor = db) {
  return executor.maybeOne(`
    INSERT INTO group_members (group_id, user_id)
    VALUES ($1, $2)
    ON CONFLICT (group_id, user_id) DO NOTHING
    RETURNING group_id, user_id, joined_at
  `, [groupId, userId]);
}

export const removeMember = (groupId, userId, executor = db) =>
  executor.maybeOne(`
    DELETE FROM group_members
    WHERE group_id = $1 AND user_id = $2
    RETURNING user_id
  `, [groupId, userId]);

/* ─── invite codes ──────────────────────────────────────────────────────── */

/**
 * Resolve a raw invite code to the full (group + course) context that
 * `joinByInviteCode` needs to return. Emits the course's slug / title so
 * the service does not have to do a second round-trip through
 * courses.service. See ADR 0008 §"Cross-module data flow" for why we
 * read the sibling courses table directly.
 */
export const findGroupByInviteCode = (code, executor = db) =>
  executor.maybeOne(`
    SELECT
      g.id            AS group_id,
      g.slug          AS group_slug,
      g.title         AS group_title,
      g.invite_code,
      g.invite_enabled,
      c.id            AS course_id,
      c.slug          AS course_slug,
      c.title         AS course_title
    FROM groups g
    JOIN courses c ON c.id = g.course_id
    WHERE g.invite_code = $1
  `, [code]);

/**
 * Upsert-style helper for the "generate / regenerate / enable / disable"
 * flows. Each mutation in the service always knows both the code value
 * (possibly unchanged on disable) and the enabled flag it wants, so we
 * just UPDATE both columns in a single round-trip.
 */
export const setGroupInvite = (groupId, { code, enabled }, executor = db) =>
  executor.none(`
    UPDATE groups
       SET invite_code = $2,
           invite_enabled = $3,
           updated_at = NOW()
     WHERE id = $1
  `, [groupId, code, enabled]);

export const getGroupInviteInfo = (groupId, executor = db) =>
  executor.maybeOne(`
    SELECT invite_code, invite_enabled
    FROM groups
    WHERE id = $1
  `, [groupId]);
