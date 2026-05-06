export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type ProblemType = "ALGORITHM" | "SQL" | "BACKEND" | "FRONTEND";

export interface User {
  id: number;
  username: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  role: "USER" | "ADMIN";
  rating: number;
  theme: "dark" | "light";
  createdAt: string;
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
}

export type SubmissionStatus =
  | "ACCEPTED" | "WRONG_ANSWER" | "RUNTIME_ERROR" | "TLE" | "COMPILE_ERROR" | "PENDING";

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
