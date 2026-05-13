/**
 * Users service — profile reads, dashboard, leaderboard, favorites, settings.
 *
 * Cross-module dependencies (allowed per ADR 0003 §"Allowed dependencies"):
 *   - auth/service.js for password change (verify, hash, set, revoke sessions)
 *     Auth module owns the credentials side of the user record; users module
 *     owns profile fields.
 */
import { withTransaction } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import * as audit from '../audit/service.js';
import * as authSvc from '../auth/service.js';
import * as q from './queries.js';

/* ─── stats / leaderboard ───────────────────────────────────────────────── */

export async function getSiteStats() {
  const s = await q.getSiteStats();
  return { totalUsers: s.total_users, activeSolvers: s.active_solvers };
}

export async function getLeaderboard() {
  return (await q.getLeaderboard()).map((r, i) => ({
    rank: i + 1,
    id: r.id,
    username: r.username,
    fullName: r.full_name,
    avatarUrl: r.avatar_url,
    rating: r.rating,
    solved: r.solved,
    createdAt: r.created_at,
  }));
}

/* ─── public profile ────────────────────────────────────────────────────── */

export async function getPublicProfile(username) {
  const u = await q.findUserByUsername(username);
  if (!u) throw new HttpError(404, 'User not found');

  const [totals, solvedByDiff, totalsByDiff, recent, calendar] = await Promise.all([
    q.getSubmissionTotalsForUser(u.id),
    q.getSolvedByDifficulty(u.id),
    q.getTotalsByDifficulty(),
    q.getRecentSubmissionsBrief(u.id, 10),
    q.getActivityCalendar(u.id),
  ]);

  return {
    user: authSvc.publicUser(u),
    stats: {
      totalSubmissions: totals?.total || 0,
      accepted: totals?.accepted || 0,
      acceptanceRate: totals?.total
        ? +(totals.accepted / totals.total * 100).toFixed(1)
        : 0,
      solvedByDifficulty: ['EASY', 'MEDIUM', 'HARD'].map((d) => ({
        difficulty: d,
        solved: solvedByDiff.find((r) => r.difficulty === d)?.solved || 0,
        total: totalsByDiff.find((r) => r.difficulty === d)?.n || 0,
      })),
    },
    recentSubmissions: recent.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      problem: { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty },
    })),
    calendar,
  };
}

/* ─── dashboard ─────────────────────────────────────────────────────────── */

export async function getDashboard(user) {
  const userId = user.id;
  const [totals, solvedByDiff, totalsByDiff, recent, recommended, days] = await Promise.all([
    q.getSubmissionTotalsForUser(userId),
    q.getSolvedByDifficulty(userId),
    q.getTotalsByDifficulty(),
    q.getRecentSubmissionsDetailed(userId, 8),
    q.getRecommendedProblems(userId, 5),
    q.getAcceptedDays(userId),
  ]);

  return {
    totals: {
      submissions: totals?.total || 0,
      accepted: totals?.accepted || 0,
      acceptanceRate: totals?.total
        ? +(totals.accepted / totals.total * 100).toFixed(1)
        : 0,
      streak: computeStreak(days),
      rating: user.rating,
    },
    solvedByDifficulty: ['EASY', 'MEDIUM', 'HARD'].map((d) => ({
      difficulty: d,
      solved: solvedByDiff.find((r) => r.difficulty === d)?.solved || 0,
      total: totalsByDiff.find((r) => r.difficulty === d)?.n || 0,
    })),
    recentSubmissions: recent.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      language: r.language,
      runtimeMs: r.runtime_ms,
      memoryKb: r.memory_kb,
      problem: { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty },
    })),
    recommended: recommended.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      difficulty: r.difficulty,
      tags: parseTags(r.tags),
    })),
  };
}

function computeStreak(daysDesc) {
  if (!daysDesc.length) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ymd = (d) => d.toISOString().slice(0, 10);
  let cursor = ymd(today);
  if (daysDesc[0] !== cursor) {
    const yesterday = new Date(today.getTime() - 86400000);
    if (daysDesc[0] === ymd(yesterday)) cursor = ymd(yesterday);
  }
  let streak = 0;
  for (const d of daysDesc) {
    if (d === cursor) {
      streak += 1;
      const next = new Date(cursor);
      next.setDate(next.getDate() - 1);
      cursor = ymd(next);
    } else if (new Date(d) < new Date(cursor)) {
      break;
    }
  }
  return streak;
}

/* ─── favorites ─────────────────────────────────────────────────────────── */

export async function getFavorites(userId) {
  return (await q.getFavoritesForUser(userId)).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    tags: parseTags(r.tags),
    category: r.category_slug ? { slug: r.category_slug, name: r.category_name } : null,
  }));
}

/* ─── profile update ────────────────────────────────────────────────────── */

const PROFILE_COLUMN_MAP = {
  fullName: 'full_name',
  avatarUrl: 'avatar_url',
  bio: 'bio',
  location: 'location',
  website: 'website',
  theme: 'theme',
};

export async function updateProfile(user, fields) {
  const updates = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    updates.push({
      column: PROFILE_COLUMN_MAP[key],
      value: value === '' ? null : value,
    });
  }
  await q.updateProfileColumns(user.id, updates);
  return authSvc.publicUser(await q.findUserById(user.id));
}

/* ─── password change ───────────────────────────────────────────────────── */

export async function changePassword(user, { currentPassword, newPassword }) {
  if (!user.password_hash) {
    throw new HttpError(400, 'This account uses Google OAuth and has no password set.');
  }
  if (!authSvc.verifyPassword(currentPassword, user.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  await authSvc.setPasswordHash(user.id, authSvc.hashPassword(newPassword));
  await authSvc.revokeAllForUser(user.id);
}

/* ─── rating ────────────────────────────────────────────────────────────── */

/** Awarded by the submissions module on a first-time accepted solve. */
export function bumpRating(userId, delta, { db: executor } = {}) {
  return q.bumpRating(userId, delta, executor);
}

/* ─── role management (ADR 0006) ────────────────────────────────────────── */

/**
 * Set a user's role to one of STUDENT / INSTRUCTOR / ADMIN. The caller
 * (route layer) is responsible for ensuring the request comes from an
 * ADMIN — this service does not re-check that.
 *
 * Safeguard: the installation must always have at least one ADMIN.
 * If the operation would leave zero admins (i.e. the target is currently
 * ADMIN, the new role is not ADMIN, and there is no other ADMIN), the
 * call throws HttpError(400). This applies whether the admin is
 * demoting themselves or demoting another lone admin.
 *
 * Idempotent: setting the role to the value the user already holds is
 * a no-op and returns the public user shape unchanged.
 *
 * Returns the public-shaped user row after the update.
 */
export async function setRole(actor, targetUserId, newRole) {
  return withTransaction(async (tx) => {
    const target = await q.findUserById(targetUserId, tx);
    if (!target) throw new HttpError(404, 'User not found');

    if (target.role === newRole) {
      return authSvc.publicUser(target);
    }

    if (target.role === 'ADMIN' && newRole !== 'ADMIN') {
      const admins = await q.countAdmins(tx);
      if (admins <= 1) {
        throw new HttpError(400, 'Cannot remove the last ADMIN');
      }
    }

    await q.updateRole(targetUserId, newRole, tx);
    const updated = await q.findUserById(targetUserId, tx);
    await audit.recordEvent(actor, {
      action: 'SET_ROLE',
      entityType: 'USER_ROLE',
      entityKey: target.username,
      details: {
        targetUserId,
        targetUsername: target.username,
        previousRole: target.role,
        newRole,
      },
    }, { db: tx });
    return authSvc.publicUser(updated);
  });
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

function parseTags(s) {
  return s ? s.split(',').map((t) => t.trim()).filter(Boolean) : [];
}
