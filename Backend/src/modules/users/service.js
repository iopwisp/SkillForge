/**
 * Users service — profile reads, dashboard, leaderboard, favorites, settings.
 *
 * Cross-module dependencies (allowed per ADR 0003 §"Allowed dependencies"):
 *   - auth/service.js for password change (verify, hash, set, revoke sessions)
 *     Auth module owns the credentials side of the user record; users module
 *     owns profile fields.
 */
import { HttpError } from '../../shared/errors.js';
import * as authSvc from '../auth/service.js';
import * as q from './queries.js';

/* ─── stats / leaderboard ───────────────────────────────────────────────── */

export function getSiteStats() {
  const s = q.getSiteStats();
  return { totalUsers: s.total_users, activeSolvers: s.active_solvers };
}

export function getLeaderboard() {
  return q.getLeaderboard().map((r, i) => ({
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

export function getPublicProfile(username) {
  const u = q.findUserByUsername(username);
  if (!u) throw new HttpError(404, 'User not found');

  const totals = q.getSubmissionTotalsForUser(u.id);
  const solvedByDiff = q.getSolvedByDifficulty(u.id);
  const totalsByDiff = q.getTotalsByDifficulty();
  const recent = q.getRecentSubmissionsBrief(u.id, 10);
  const calendar = q.getActivityCalendar(u.id);

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

export function getDashboard(user) {
  const userId = user.id;
  const totals = q.getSubmissionTotalsForUser(userId);
  const solvedByDiff = q.getSolvedByDifficulty(userId);
  const totalsByDiff = q.getTotalsByDifficulty();
  const recent = q.getRecentSubmissionsDetailed(userId, 8);
  const recommended = q.getRecommendedProblems(userId, 5);
  const days = q.getAcceptedDays(userId);

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

export function getFavorites(userId) {
  return q.getFavoritesForUser(userId).map((r) => ({
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

export function updateProfile(user, fields) {
  const sets = [];
  const args = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`${PROFILE_COLUMN_MAP[key]} = ?`);
    args.push(value === '' ? null : value);
  }
  q.updateProfileColumns(user.id, sets, args);
  return authSvc.publicUser(q.findUserById(user.id));
}

/* ─── password change ───────────────────────────────────────────────────── */

export function changePassword(user, { currentPassword, newPassword }) {
  if (!user.password_hash) {
    throw new HttpError(400, 'This account uses Google OAuth and has no password set.');
  }
  if (!authSvc.verifyPassword(currentPassword, user.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  authSvc.setPasswordHash(user.id, authSvc.hashPassword(newPassword));
  authSvc.revokeAllForUser(user.id);
}

/* ─── rating ────────────────────────────────────────────────────────────── */

/** Awarded by the submissions module on a first-time accepted solve. */
export function bumpRating(userId, delta) {
  q.bumpRating(userId, delta);
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

function parseTags(s) {
  return s ? s.split(',').map((t) => t.trim()).filter(Boolean) : [];
}
