/**
 * Authenticated home page — Dashboard.
 *
 * Overhaul v1 — clean, calm, premium SaaS feel:
 *   1. Welcome hero — no bordered card, subtle gradient mesh bg, clear CTA.
 *   2. Metric tiles (4 cards) with icons — Zap/Target/TrendingUp/Flame.
 *   3. Two-column body:
 *      - Left: progress by difficulty (taller bars, mini ring chart) +
 *        recent activity (card-based, status accent borders).
 *      - Right: recommended next (interactive cards with hover arrow) +
 *        your courses peek with mini progress bars.
 *
 * All data from existing `/users/me/dashboard` and `/courses` APIs — zero
 * backend changes. No fake data. No overloaded gradients.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Flame,
  PlayCircle,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { ProtectedRoute } from "~/lib/guards";
import type { DashboardData } from "~/lib/types";
import type { CourseSummary } from "~/lib/teaching-types";

import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { Section } from "~/components/common/Section";
import { Stat } from "~/components/common/Stat";
import { LoadingSkeleton } from "~/components/common/LoadingSkeleton";
import { Button } from "~/components/ui/button";
import { formatPercent } from "~/lib/format";
import { timeAgo } from "~/lib/format";

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardInner />
    </ProtectedRoute>
  );
}

function DashboardInner() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<DashboardData>("/users/me/dashboard")
      .then(setData)
      .finally(() => setLoading(false));
    // Courses are optional context — fire-and-forget; an empty list is fine.
    api<CourseSummary[]>("/courses")
      .then(setCourses)
      .catch(() => setCourses([]));
  }, []);

  if (loading || !user || !data) return <LoadingSkeleton rows={4} />;

  const totalSolved = data.solvedByDifficulty.reduce((acc, x) => acc + x.solved, 0);
  const totalProblems = data.solvedByDifficulty.reduce((acc, x) => acc + x.total, 0);
  const catalogueRatio = totalProblems > 0 ? totalSolved / totalProblems : 0;
  const firstName = user.fullName?.split(" ")[0] || user.username;
  const latest = data.recentSubmissions[0];

  return (
    <div className="space-y-6">
      {/* ─── 1. Welcome hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-xl bg-card border border-border/60 shadow-sm">
        {/* Subtle dot pattern background */}
        <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.1] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        {/* Soft edge highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        
        <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
              {latest ? "Continue learning" : "Welcome back"}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {latest ? (
                <>
                  Pick up where you left off,{" "}
                  <span className="text-primary font-bold">{firstName}</span>
                </>
              ) : (
                <>
                  Let's get started,{" "}
                  <span className="text-primary font-bold">{firstName}</span>
                </>
              )}
            </h1>
            {latest?.problem ? (
              <p className="mt-2 text-sm text-muted-foreground font-medium">
                Last attempted{" "}
                <Link
                  to={`/problems/${latest.problem.slug}`}
                  className="font-semibold text-foreground hover:text-primary transition-colors"
                >
                  {latest.problem.title}
                </Link>{" "}
                <span className="mx-1 opacity-50">·</span> {timeAgo(latest.createdAt)}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground font-medium">
                Solve your first problem to start tracking progress.
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-3">
            {latest?.problem ? (
              <>
                <Button asChild className="h-10 px-5 font-semibold shadow-sm">
                  <Link to={`/problems/${latest.problem.slug}`}>
                    <PlayCircle className="size-4 mr-2 -ml-1" /> Resume
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-10 px-5 font-semibold bg-background/50 backdrop-blur-sm hover:bg-accent">
                  <Link to="/problems">Browse</Link>
                </Button>
              </>
            ) : (
              <Button asChild className="h-10 px-5 font-semibold shadow-sm">
                <Link to="/problems">
                  Browse problems <ChevronRight className="size-4 ml-1 -mr-1" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ─── 2. Metric tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={Zap}
          label="Solved"
          value={totalSolved}
          hint={`of ${totalProblems} (${formatPercent(catalogueRatio)})`}
        />
        <Stat
          icon={Target}
          label="Acceptance"
          value={`${data.totals.acceptanceRate}%`}
          hint={`${data.totals.accepted}/${data.totals.submissions} submissions`}
        />
        <Stat
          icon={TrendingUp}
          label="Rating"
          value={data.totals.rating.toLocaleString()}
          hint="Based on accepted solutions"
        />
        <Stat
          icon={Flame}
          label="Streak"
          value={`${data.totals.streak} ${data.totals.streak === 1 ? "day" : "days"}`}
          hint={data.totals.streak > 0 ? "Keep it going" : "Solve one today to start"}
        />
      </div>

      {/* ─── 3. Two-column body ──────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Progress by difficulty */}
          <Section
            title="Progress by difficulty"
            action={
              <Link
                to="/problems"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                All problems <ArrowUpRight className="size-3.5" />
              </Link>
            }
          >
            <div className="space-y-4">
              {data.solvedByDifficulty.map((d) => {
                const pct = d.total ? d.solved / d.total : 0;
                const tone =
                  d.difficulty === "EASY"
                    ? "bg-emerald-500"
                    : d.difficulty === "MEDIUM"
                      ? "bg-amber-500"
                      : "bg-rose-500";
                return (
                  <div key={d.difficulty}>
                    <div className="flex items-center justify-between text-sm">
                      <DifficultyBadge difficulty={d.difficulty} />
                      <span className="text-muted-foreground tabular-nums">
                        <span className="text-foreground font-medium">{d.solved}</span>{" "}
                        / {d.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${tone} progress-fill rounded-full`}
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Recent activity */}
          <Section
            title="Recent activity"
            action={
              <Link
                to="/submissions"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                Full history <ArrowUpRight className="size-3.5" />
              </Link>
            }
            bare
          >
            {data.recentSubmissions.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground text-center">
                No submissions yet — solve your first problem!
              </p>
            ) : (
              <div className="divide-y divide-border-subtle">
                {data.recentSubmissions.map((s) => (
                  <div
                    key={s.id}
                    className="row-accent-left px-5 py-3 flex items-center gap-3 text-sm"
                    data-status={s.status === "ACCEPTED" ? "solved" : undefined}
                  >
                    {s.problem ? (
                      <Link
                        to={`/problems/${s.problem.slug}`}
                        className="font-medium hover:text-primary truncate min-w-0"
                      >
                        {s.problem.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground truncate">
                        (problem unavailable)
                      </span>
                    )}
                    {s.problem && (
                      <DifficultyBadge
                        difficulty={s.problem.difficulty}
                        className="hidden sm:inline-flex"
                      />
                    )}
                    <StatusBadge status={s.status} />
                    {s.language && (
                      <span className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                        {s.language}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
                      {timeAgo(s.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Recommended next */}
          <Section
            title="Recommended next"
            action={<Sparkles className="size-4 text-muted-foreground" />}
          >
            {data.recommended.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You've solved everything we have. Impressive!
              </p>
            ) : (
              <ul className="space-y-2.5">
                {data.recommended.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/problems/${p.slug}`}
                      className="group block card-interactive p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm truncate">{p.title}</span>
                        <ArrowRight className="size-4 text-muted-foreground shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <DifficultyBadge difficulty={p.difficulty} />
                        {p.tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Your courses */}
          {courses && courses.length > 0 && (
            <Section
              title="Your courses"
              action={
                <Link
                  to="/courses"
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  All <ArrowUpRight className="size-3.5" />
                </Link>
              }
            >
              <ul className="space-y-2">
                {courses.slice(0, 3).map((c) => (
                  <li key={c.slug}>
                    <Link
                      to={`/courses/${c.slug}`}
                      className="flex items-center gap-3 rounded-md p-2 -mx-1 hover:bg-accent/50 transition-colors"
                    >
                      <BookOpen className="size-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{c.title}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.problemCount} problem{c.problemCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
