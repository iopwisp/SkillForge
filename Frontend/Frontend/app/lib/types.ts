export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type ProblemType = "ALGORITHM" | "SQL" | "BACKEND" | "FRONTEND" | "STDIO";

/**
 * Closed set of roles, mirrors `auth/middleware.js#ROLES` on the backend.
 * The bootstrap rule (first user becomes ADMIN, subsequent self-service
 * signups default to STUDENT) is enforced server-side per ADR 0006.
 */
export type Role = "STUDENT" | "INSTRUCTOR" | "ADMIN";

export interface User {
  id: number;
  username: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  role: Role;
  rating: number;
  theme: "dark" | "light";
  createdAt: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  STUDENT: "Student",
  INSTRUCTOR: "Instructor",
  ADMIN: "Admin",
};

/** True iff the user can act as instructor (manage their own courses, etc.). */
export function canTeach(user: { role: Role } | null | undefined): boolean {
  return user?.role === "INSTRUCTOR" || user?.role === "ADMIN";
}

/** True iff the user has installation-wide admin privileges. */
export function isAdmin(user: { role: Role } | null | undefined): boolean {
  return user?.role === "ADMIN";
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: User;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  problem_count?: number;
}

export interface ProblemSummary {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  problemType?: ProblemType;
  tags: string[];
  category: { slug: string; name: string } | null;
  isPremium: boolean;
  totalSubmissions: number;
  acceptedSubmissions: number;
  acceptanceRate: number;
  status: "solved" | "attempted" | null;
  favorited: boolean;
}

export interface Example {
  input: string;
  output: string;
  explanation?: string;
}

export interface ProblemDetail extends ProblemSummary {
  description: string;
  examples: Example[];
  constraints: string;
  hints: string[];
  starterCode: Record<string, string>;
  /** SQL DDL/DML run before each SQL submission (only set for SQL problems). */
  sqlSetup?: string | null;
  /** Required entry-point function name for JS-judged problems. */
  functionName?: string | null;
  timeLimitMs: number;
  memoryLimitMb: number;
  /** STDIO-specific: sample test cases visible to students. */
  sampleTestCases?: Array<{ stdin: string; expected_stdout: string; name?: string }>;
  /** STDIO-specific: max output size in KB. */
  outputSizeCapKb?: number;
  /** STDIO-specific: comparator mode for output comparison. */
  comparatorMode?: "EXACT" | "TRIMMED" | "WHITESPACE_NORMALIZED";
  /** STDIO-specific: languages allowed for this problem. */
  languageAllowlist?: string[];
}

export type SubmissionStatus =
  | "ACCEPTED" | "WRONG_ANSWER" | "RUNTIME_ERROR" | "TLE" | "COMPILE_ERROR"
  | "PENDING" | "JUDGE_ERROR";

export interface Submission {
  id: number;
  status: SubmissionStatus;
  language: string;
  code?: string;
  runtimeMs?: number;
  memoryKb?: number;
  testsPassed?: number;
  testsTotal?: number;
  output?: string | null;
  error?: string | null;
  beats?: number;
  createdAt: string;
  problem?: { slug: string; title: string; difficulty: Difficulty };
  /** STDIO-specific: per-test results after judge finalization. */
  perTestResults?: Array<{
    index: number;
    verdict: string;
    time_ms: number;
    memory_mb: number;
    stdout_bytes: number;
    visibility: 'SAMPLE' | 'HIDDEN';
    stderr_tail: string;
    actual_output?: string;
  }> | null;
}

export interface DashboardData {
  totals: {
    submissions: number;
    accepted: number;
    acceptanceRate: number;
    streak: number;
    rating: number;
  };
  solvedByDifficulty: Array<{ difficulty: Difficulty; solved: number; total: number }>;
  recentSubmissions: Submission[];
  recommended: Array<{ id: number; slug: string; title: string; difficulty: Difficulty; tags: string[] }>;
}

export interface LeaderboardEntry {
  rank: number;
  id: number;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  rating: number;
  solved: number;
  createdAt: string;
}
