/**
 * Types for the instructor / admin surfaces (courses, groups, exams,
 * problem creator, audit log, role management). Mirrors the JSON shapes
 * returned by the corresponding backend services.
 *
 * Naming follows the JSON the backend actually emits (camelCase), not the
 * underlying Postgres column names.
 */
import type { Difficulty, ProblemType, Role } from "./types";

/* ─── Courses ────────────────────────────────────────────────────────────── */

export interface CourseSummary {
  slug: string;
  title: string;
  owner: { id: number; username: string; fullName: string | null };
  problemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CourseProblemRef {
  slug: string;
  title: string;
  difficulty: Difficulty;
  problemType: ProblemType;
  tags: string[];
  position: number;
  addedAt: string;
}

export interface CourseDetail extends CourseSummary {
  description: string | null;
  problems: CourseProblemRef[];
}

/* ─── Groups ─────────────────────────────────────────────────────────────── */

export interface GroupSummary {
  slug: string;
  title: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: number;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMember[];
}

/* ─── Exams ──────────────────────────────────────────────────────────────── */

export interface ExamSummary {
  slug: string;
  title: string;
  groupSlug: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  problemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamProblemRef {
  slug: string;
  title: string;
  difficulty: Difficulty;
  problemType: ProblemType;
  position: number;
  points: number;
}

export interface ExamDetail extends ExamSummary {
  description: string | null;
  problems: ExamProblemRef[];
  totalPoints: number;
}

/* ─── Gradebook ──────────────────────────────────────────────────────────── */

export interface GradebookExam {
  slug: string;
  title: string;
  groupSlug: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  problemCount: number;
  totalPoints: number;
}

export interface GradebookScore {
  examSlug: string;
  applicable: boolean;
  attempted: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  score: { earned: number; total: number; solved: number; outOf: number } | null;
}

export interface GradebookRow {
  student: {
    id: number;
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
  };
  groups: Array<{ slug: string; title: string | null }>;
  scores: GradebookScore[];
  total: {
    earned: number;
    total: number;
    applicableExams: number;
    attemptedExams: number;
  };
}

export interface Gradebook {
  course: CourseSummary & { description: string | null; studentCount: number };
  exams: GradebookExam[];
  rows: GradebookRow[];
}

/* ─── Exam attempts (student-facing) ─────────────────────────────────────── */

export interface ExamAttempt {
  examSlug: string;
  startedAt: string;
  finishedAt: string | null;
  deadline: string;
  timeLeftMs: number;
  score: { earned: number; total: number; solved: number; outOf: number };
  submissions: ExamAttemptSubmission[];
}

export interface ExamAttemptSubmission {
  id: number;
  problem: { slug: string; title: string; difficulty: Difficulty };
  status: import("./types").SubmissionStatus;
  language: string;
  createdAt: string;
  testsPassed?: number;
  testsTotal?: number;
}

/* ─── Problem authoring ──────────────────────────────────────────────────── */

export interface ProblemEditorDetail {
  slug: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  problemType: ProblemType;
  categorySlug: string;
  tags: string[];
  examples: Array<{ input: string; output: string; explanation?: string }>;
  constraints: string;
  hints: string[];
  starterCode: Record<string, string>;
  expectedOutput: string;
  testCases: any[];
  sqlSetup: string;
  functionName: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  isPremium: boolean;
  createdAt?: string;
}

/* ─── STDIO problem types ─────────────────────────────────────────────────── */

export type StdioComparatorMode = 'EXACT' | 'TRIMMED' | 'WHITESPACE_NORMALIZED';
export type StdioLanguage = 'JAVASCRIPT' | 'PYTHON' | 'JAVA' | 'GO' | 'CPP';

export interface StdioTestCase {
  stdin: string;
  expected_stdout: string;
  visibility: 'SAMPLE' | 'HIDDEN';
  name?: string;
}

export interface StdioEditorProblem {
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  problemType: 'STDIO';
  categorySlug: string;
  tags: string[];
  examples: Array<{ input: string; output: string; explanation?: string }>;
  constraints: string;
  hints: string[];
  starterCode: Record<string, string>;
  testCases: StdioTestCase[];
  timeLimitMs: number;
  memoryLimitMb: number;
  outputSizeCapKb: number;
  comparatorMode: StdioComparatorMode;
  languageAllowlist: StdioLanguage[];
}

export interface StdioPublicProblem {
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  problemType: 'STDIO';
  sampleTestCases: Array<{ stdin: string; expected_stdout: string; name?: string }>;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputSizeCapKb: number;
  comparatorMode: StdioComparatorMode;
  languageAllowlist: StdioLanguage[];
}

export interface StdioPerTestResult {
  index: number;
  verdict: string;
  time_ms: number;
  memory_mb: number;
  stdout_bytes: number;
  visibility: 'SAMPLE' | 'HIDDEN';
  stderr_tail: string;
  actual_output?: string;
}

/* ─── Audit log ──────────────────────────────────────────────────────────── */

export interface AuditEvent {
  id: number;
  actor: { id: number; username: string; role: Role };
  action: string;
  entityType: string;
  entityKey: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

/* ─── Contests ───────────────────────────────────────────────────────────── */

export type ContestStatus = 'upcoming' | 'running' | 'finished';

export interface ContestListItem {
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isPublic: boolean;
  status: ContestStatus;
  participantCount: number;
}

export interface ContestListPage {
  items: ContestListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ContestProblemRef {
  letter: string;
  id?: number;
  slug?: string;
  title: string;
  difficulty?: Difficulty;
  problemType?: ProblemType;
}

export interface ContestParticipation {
  id: number;
  startedAt: string;
  personalDeadline: string;
  isVirtual: boolean;
}

export interface ContestDetail {
  id: number;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  freezeMinutes: number;
  isPublic: boolean;
  editorial: string | null;
  createdAt: string;
  status: ContestStatus;
  participantCount: number;
  isRegistered: boolean;
  isParticipating: boolean;
  participation: ContestParticipation | null;
  problems: ContestProblemRef[];
}

export interface ContestEditorial {
  slug: string;
  content: string;
}

/* ─── Contest standings ──────────────────────────────────────────────────── */

export interface ContestProblemResult {
  attempts: number;
  acceptedAt: string | null;
  penaltyMinutes: number;
  isFirstSolve: boolean;
}

export interface ContestStandingEntry {
  rank: number;
  participationId: number;
  userId: number;
  username: string;
  isVirtual: boolean;
  solvedCount: number;
  penaltyTime: number;
  problems: Record<string, ContestProblemResult>;
}

export interface ContestStandings {
  status: ContestStatus;
  frozen: boolean;
  freezeStart: string | null;
  standings: ContestStandingEntry[];
}

/* ─── User contest history + rating (profile page) ───────────────────────── */

export interface UserContestHistoryEntry {
  contestSlug: string;
  contestTitle: string;
  date: string;
  isVirtual: boolean;
  rank: number | null;
  solvedCount: number;
  penaltyTime: number;
  ratingChange: number | null;
  newRating: number | null;
}

export interface UserContestRatingHistoryEntry {
  contestSlug: string;
  contestTitle: string;
  date: string;
  oldRating: number;
  newRating: number;
  delta: number;
  rank: number;
}

export interface UserContestRating {
  username: string;
  rating: number | null;
  ratingDeviation: number | null;
  volatility: number | null;
  contestsPlayed: number;
  lastContestAt: string | null;
  history: UserContestRatingHistoryEntry[];
}


/* ─── Live Instructor Dashboard ──────────────────────────────────────────── */

export type CellStatus = 'SOLVED' | 'ATTEMPTING' | 'STUCK' | 'IDLE';

export interface LiveStudent {
  id: number;
  username: string;
  fullName: string | null;
  groupSlug: string;
}

export interface LiveProblem {
  slug: string;
  title: string;
  position: number;
}

export interface LiveCell {
  status: CellStatus;
  lastSubmitAt: string | null;
  attempts: number;
}

export interface LiveSummary {
  totalStudents: number;
  solved: number;
  attempting: number;
  stuck: number;
  idle: number;
}

export interface LiveDashboardResponse {
  course: { slug: string; title: string };
  exam: { slug: string; title: string } | null;
  group: { slug: string; title: string } | null;
  students: LiveStudent[];
  problems: LiveProblem[];
  matrix: Record<string, LiveCell>;
  summary: LiveSummary;
}
