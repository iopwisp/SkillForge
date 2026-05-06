import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Trophy, Flame, ListChecks, Activity, ArrowUpRight,
  Sparkles, BarChart3,
} from "lucide-react";
import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { ProtectedRoute, Loading } from "~/lib/guards";
import type { DashboardData } from "~/lib/types";
import { PageHeader } from "~/components/common/PageHeader";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { Button } from "~/components/ui/button";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<DashboardData>("/users/me/dashboard")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !user) return <Loading />;
  if (!data) return null;

  const totalSolved = data.solvedByDifficulty.reduce((acc, x) => acc + x.solved, 0);
  const totalProblems = data.solvedByDifficulty.reduce((acc, x) => acc + x.total, 0);

  return (
    <>
      <PageHeader
        title={<>Welcome back, <span className="gradient-text">{user.fullName?.split(" ")[0] || user.username}</span></>}
        description="Here’s a snapshot of your practice on SkillForge."
        action={
          <Button asChild className="gradient-bg text-white border-0">
            <Link to="/problems"><Sparkles className="size-4 mr-1.5" /> New problem</Link>
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={ListChecks} color="indigo"
          label="Problems solved"
          value={`${totalSolved} / ${totalProblems}`}
          hint={`${totalProblems ? Math.round(totalSolved / totalProblems * 100) : 0}% of catalogue`}
        />
        <StatCard
          icon={Flame} color="amber"
          label="Active streak"
          value={`${data.totals.streak} ${data.totals.streak === 1 ? "day" : "days"}`}
          hint={data.totals.streak > 0 ? "Keep it going!" : "Solve one today to start"}
        />
        <StatCard
          icon={Trophy} color="violet"
          label="Rating"
          value={data.totals.rating.toLocaleString()}
          hint="Earned from accepted solutions"
        />
        <StatCard
          icon={BarChart3} color="emerald"
          label="Acceptance"
          value={`${data.totals.acceptanceRate}%`}
          hint={`${data.totals.accepted}/${data.totals.submissions} submissions`}
        />
      </div>

      <div className="mt-6 grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Difficulty breakdown */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Progress by difficulty</h2>
              <Link to="/problems" className="text-xs text-primary hover:underline">All problems →</Link>
            </div>
            <div className="mt-4 space-y-4">
              {data.solvedByDifficulty.map(d => {
                const pct = d.total ? Math.round((d.solved / d.total) * 100) : 0;
                const tone =
                  d.difficulty === "EASY" ? "bg-emerald-500" :
                  d.difficulty === "MEDIUM" ? "bg-amber-500" : "bg-rose-500";
                return (
                  <div key={d.difficulty}>
                    <div className="flex items-center justify-between text-sm">
                      <DifficultyBadge difficulty={d.difficulty} />
                      <span className="text-muted-foreground tabular-nums">
                        <span className="text-foreground font-medium">{d.solved}</span> / {d.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Recent activity */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Recent activity</h2>
              <Link to="/submissions" className="text-xs text-primary hover:underline">Full history →</Link>
            </div>
            <div className="mt-4 -mx-4">
              {data.recentSubmissions.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">No submissions yet — solve your first problem!</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.recentSubmissions.map(s => (
                    <li key={s.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                      <Activity className="size-4 shrink-0 text-muted-foreground" />
                      <Link to={`/problems/${s.problem?.slug}`} className="font-medium hover:text-primary truncate">
                        {s.problem?.title}
                      </Link>
                      {s.problem && <DifficultyBadge difficulty={s.problem.difficulty} className="hidden sm:inline-flex" />}
                      <StatusBadge status={s.status} />
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{timeAgo(s.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {/* Recommended */}
        <div>
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Recommended next</h2>
              <Sparkles className="size-4 text-primary" />
            </div>
            <ul className="mt-4 space-y-3">
              {data.recommended.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">You’ve solved everything we have. Impressive!</p>
              ) : data.recommended.map(p => (
                <li key={p.id}>
                  <Link to={`/problems/${p.slug}`}
                    className="block rounded-lg border border-border p-3 hover:border-primary/40 hover:bg-accent/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">{p.title}</span>
                      <ArrowUpRight className="size-4 text-muted-foreground shrink-0" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <DifficultyBadge difficulty={p.difficulty} />
                      {p.tags.slice(0, 2).map(t => (
                        <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon, label, value, hint, color,
}: {
  icon: any; label: string; value: React.ReactNode; hint?: string;
  color: "indigo" | "amber" | "violet" | "emerald";
}) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-500/10 text-indigo-500",
    amber: "bg-amber-500/10 text-amber-500",
    violet: "bg-violet-500/10 text-violet-500",
    emerald: "bg-emerald-500/10 text-emerald-500",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
        <div className={`size-10 rounded-lg flex items-center justify-center ${tones[color]}`}>
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5">{children}</div>;
}
