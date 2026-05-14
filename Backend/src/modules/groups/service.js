/**
 * Groups service — per-course cohorts + member enrolment.
 *
 * Permissions (per ADR 0008):
 *   - Read: requireAuth at the route layer; this service additionally
 *     narrows to "member-only" for STUDENT callers.
 *   - Mutate (create/update/delete/add-member/remove-member): course
 *     owner or ADMIN. Enforced in `assertCanManageCourse` which reads
 *     the course's owner_id directly from the courses table (ADR 0008
 *     §"Cross-module data flow") so this module does NOT need to import
 *     courses.service and avoid a circular dependency with the course
 *     visibility logic that lives there.
 */
import { randomInt } from 'node:crypto';

import { withTransaction } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import * as audit from '../audit/service.js';
import * as q from './queries.js';

const ADMIN = 'ADMIN';
const STUDENT = 'STUDENT';

/* ─── read ──────────────────────────────────────────────────────────────── */

export async function listGroups(actor, courseSlug) {
  const course = await resolveCourseOr404(courseSlug);
  const rows = actor.role === STUDENT
    ? await q.listGroupsForCourseAndUser(course.id, actor.id)
    : await q.listGroupsForCourse(course.id);
  return rows.map(toGroupSummary);
}

export async function getGroup(actor, courseSlug, groupSlug) {
  const course = await resolveCourseOr404(courseSlug);
  const group = await q.findGroupByCourseAndSlug(course.id, groupSlug);
  if (!group) throw new HttpError(404, 'Group not found');

  if (actor.role === STUDENT && !(await q.isMember(group.id, actor.id))) {
    // Don't leak the existence of groups the student isn't in.
    throw new HttpError(404, 'Group not found');
  }
  const members = await q.listMembers(group.id);
  return {
    ...toGroupSummary({ ...group, member_count: members.length }),
    members: members.map(toMember),
  };
}

export async function listMembers(actor, courseSlug, groupSlug) {
  const course = await resolveCourseOr404(courseSlug);
  const group = await q.findGroupByCourseAndSlug(course.id, groupSlug);
  if (!group) throw new HttpError(404, 'Group not found');

  if (actor.role === STUDENT && !(await q.isMember(group.id, actor.id))) {
    throw new HttpError(404, 'Group not found');
  }
  return (await q.listMembers(group.id)).map(toMember);
}

/* ─── mutate ────────────────────────────────────────────────────────────── */

export async function createGroup(actor, courseSlug, { slug, title }) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  return withTransaction(async (tx) => {
    const existing = await q.findGroupByCourseAndSlug(course.id, slug, tx);
    if (existing) {
      throw new HttpError(409, `Group "${slug}" already exists in this course`);
    }
    const inserted = await q.insertGroup({ courseId: course.id, slug, title }, tx);
    await audit.recordEvent(actor, {
      action: 'CREATE',
      entityType: 'GROUP',
      entityKey: `${courseSlug}:${slug}`,
      details: { courseSlug, groupSlug: slug, title },
    }, { db: tx });
    return toGroupSummary({ ...inserted, member_count: 0 });
  });
}

export async function updateGroup(actor, courseSlug, groupSlug, fields) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  return withTransaction(async (tx) => {
    const group = await q.findGroupByCourseAndSlug(course.id, groupSlug, tx);
    if (!group) throw new HttpError(404, 'Group not found');
    await q.updateGroup(group.id, fields, tx);
    await audit.recordEvent(actor, {
      action: 'UPDATE',
      entityType: 'GROUP',
      entityKey: `${courseSlug}:${groupSlug}`,
      details: { courseSlug, groupSlug, fields: Object.keys(fields) },
    }, { db: tx });
    const updated = await q.findGroupByCourseAndSlug(course.id, groupSlug, tx);
    const members = await q.listMembers(group.id, tx);
    return toGroupSummary({ ...updated, member_count: members.length });
  });
}

export async function deleteGroup(actor, courseSlug, groupSlug) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  return withTransaction(async (tx) => {
    const group = await q.findGroupByCourseAndSlug(course.id, groupSlug, tx);
    if (!group) throw new HttpError(404, 'Group not found');
    await audit.recordEvent(actor, {
      action: 'DELETE',
      entityType: 'GROUP',
      entityKey: `${courseSlug}:${groupSlug}`,
      details: { courseSlug, groupSlug },
    }, { db: tx });
    await q.deleteGroup(group.id, tx);
  });
}

export async function addMember(actor, courseSlug, groupSlug, { username }) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  const group = await q.findGroupByCourseAndSlug(course.id, groupSlug);
  if (!group) throw new HttpError(404, 'Group not found');

  const userId = await q.findUserIdByUsername(username);
  if (!userId) throw new HttpError(404, `User "${username}" not found`);

  const inserted = await q.addMember(group.id, userId);
  if (!inserted) {
    throw new HttpError(409, `"${username}" is already a member of this group`);
  }
  await audit.recordEvent(actor, {
    action: 'ADD_MEMBER',
    entityType: 'GROUP_MEMBER',
    entityKey: `${courseSlug}:${groupSlug}:${username}`,
    details: { courseSlug, groupSlug, username, userId },
  });
  return {
    courseSlug,
    groupSlug,
    user: { id: userId, username },
    joinedAt: inserted.joined_at,
  };
}

export async function removeMember(actor, courseSlug, groupSlug, username) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  const group = await q.findGroupByCourseAndSlug(course.id, groupSlug);
  if (!group) throw new HttpError(404, 'Group not found');

  const userId = await q.findUserIdByUsername(username);
  if (!userId) throw new HttpError(404, `User "${username}" not found`);

  const removed = await q.removeMember(group.id, userId);
  if (!removed) {
    throw new HttpError(404, `"${username}" is not a member of this group`);
  }
  await audit.recordEvent(actor, {
    action: 'REMOVE_MEMBER',
    entityType: 'GROUP_MEMBER',
    entityKey: `${courseSlug}:${groupSlug}:${username}`,
    details: { courseSlug, groupSlug, username, userId },
  });
}

/* ─── invite codes (self-enrolment) ─────────────────────────────────────── */

/**
 * 32-char alphabet intentionally excluding the ambiguous pairs O/0 and
 * I/1 so a student squinting at a printed/projected code can type what
 * they see without juggling "looks like a zero" guesses.
 */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LEN = 8; // 8 chars → 32^8 ≈ 10^12 space; plenty for a university.

/** Emit a cryptographically random 8-char code formatted as `ABCD-1234`. */
function generateInviteCode() {
  let raw = '';
  for (let i = 0; i < INVITE_CODE_LEN; i += 1) {
    raw += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Normalise user-provided codes: strip whitespace + dashes, uppercase. */
export function normalizeInviteCode(input) {
  if (typeof input !== 'string') return '';
  const cleaned = input.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (cleaned.length !== INVITE_CODE_LEN) return '';
  // Stored format is `ABCD-1234`; normalise back to that so the UNIQUE
  // index lookup matches what we stored.
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

export async function generateInvite(actor, courseSlug, groupSlug) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  return withTransaction(async (tx) => {
    const group = await q.findGroupByCourseAndSlug(course.id, groupSlug, tx);
    if (!group) throw new HttpError(404, 'Group not found');

    // Retry on the astronomically unlikely UNIQUE collision with another
    // group's code. 32^8 space, so in practice this loop runs exactly once.
    let code = generateInviteCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await q.findGroupByInviteCode(code, tx);
      if (!clash || clash.group_id === group.id) break;
      code = generateInviteCode();
    }

    await q.setGroupInvite(group.id, { code, enabled: true }, tx);
    await audit.recordEvent(actor, {
      action: 'GENERATE_INVITE',
      entityType: 'GROUP',
      entityKey: `${courseSlug}:${groupSlug}`,
      details: { courseSlug, groupSlug },
    }, { db: tx });
    return { code, enabled: true };
  });
}

export async function disableInvite(actor, courseSlug, groupSlug) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  return withTransaction(async (tx) => {
    const group = await q.findGroupByCourseAndSlug(course.id, groupSlug, tx);
    if (!group) throw new HttpError(404, 'Group not found');

    const current = await q.getGroupInviteInfo(group.id, tx);
    // Keep the code on disable — see ADR note above; only flip the flag.
    await q.setGroupInvite(
      group.id,
      { code: current?.invite_code ?? null, enabled: false },
      tx,
    );
    await audit.recordEvent(actor, {
      action: 'DISABLE_INVITE',
      entityType: 'GROUP',
      entityKey: `${courseSlug}:${groupSlug}`,
      details: { courseSlug, groupSlug },
    }, { db: tx });
    return { code: current?.invite_code ?? null, enabled: false };
  });
}

export async function getInvite(actor, courseSlug, groupSlug) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  const group = await q.findGroupByCourseAndSlug(course.id, groupSlug);
  if (!group) throw new HttpError(404, 'Group not found');

  const info = await q.getGroupInviteInfo(group.id);
  return {
    code: info?.invite_code ?? null,
    enabled: !!info?.invite_enabled,
  };
}

/**
 * Student-facing self-enrolment. Any authenticated user may call this;
 * the "authorization" here is possession of the code itself.
 *
 * Idempotent on membership: re-entering the same code when already
 * enrolled returns the same 200 shape rather than a 409, so students
 * who click a shared link twice don't see a scary "already a member"
 * error. The ON CONFLICT DO NOTHING in `group_members` makes this safe.
 */
export async function joinByInviteCode(user, rawCode) {
  const code = normalizeInviteCode(rawCode);
  if (!code) throw new HttpError(404, 'Invalid invite code');

  const found = await q.findGroupByInviteCode(code);
  if (!found) throw new HttpError(404, 'Invalid invite code');
  if (!found.invite_enabled) {
    throw new HttpError(410, 'This invite code is no longer active');
  }

  return withTransaction(async (tx) => {
    const inserted = await q.addMember(found.group_id, user.id, tx);
    // Only audit the new join; silent no-op for already-members.
    if (inserted) {
      await audit.recordEvent(user, {
        action: 'JOIN_BY_INVITE',
        entityType: 'GROUP_MEMBER',
        entityKey: `${found.course_slug}:${found.group_slug}:${user.username}`,
        details: {
          courseSlug: found.course_slug,
          groupSlug: found.group_slug,
        },
      }, { db: tx });
    }
    return {
      course: { slug: found.course_slug, title: found.course_title },
      group: { slug: found.group_slug, title: found.group_title },
    };
  });
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

/**
 * Resolve courseSlug to a `{ id, owner_id }` row, or throw 404. Reads
 * the courses table directly; see ADR 0008 §"Cross-module data flow".
 */
async function resolveCourseOr404(courseSlug) {
  const course = await q.findCourseRefBySlug(courseSlug);
  if (!course) throw new HttpError(404, 'Course not found');
  return course;
}

/**
 * Owner-or-ADMIN gate for any mutation under a specific course. Routes
 * have already required INSTRUCTOR or ADMIN; this is the owner half.
 * Mirrors courses.service.assertCanMutate (kept local rather than
 * exported/imported to avoid coupling modules through a helper).
 */
function assertCanManageCourse(actor, course) {
  if (actor.role === ADMIN) return;
  if (course.owner_id === actor.id) return;
  throw new HttpError(403, 'Only the course owner or an ADMIN can manage its groups');
}

function toGroupSummary(r) {
  return {
    slug: r.slug,
    title: r.title,
    memberCount: r.member_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMember(r) {
  return {
    id: r.id,
    username: r.username,
    fullName: r.full_name,
    avatarUrl: r.avatar_url,
    role: r.role,
    joinedAt: r.joined_at,
  };
}
