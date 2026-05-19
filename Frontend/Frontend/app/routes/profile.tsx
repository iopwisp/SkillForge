/**
 * Public user profile page — `/u/:username`.
 *
 * Overhaul v1 — developer-profile feel:
 *   - Full-width header with subtle gradient mesh bg.
 *   - Avatar + name + username + role badge.
 *   - Stat strip below header (4 tiles, matching dashboard style).
 *   - Activity heatmap with month labels.
 *   - Difficulty breakdown with taller progress bars.
 *   - Recent submissions with status accent borders.
 *
 * All data from existing `/users/profile/:username` API — zero backend changes.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { MapPin, Globe, CalendarDays, Trophy, Zap, Target, TrendingUp, ArrowUpRight } from "lucide-react";
import { api } from "~/lib/api";
import { Loading } from "~/lib/guards";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { Empty } from "~/components/common/Empty";
import { Stat } from "~/components/common/Stat";
import { Section } from "~/components/common/Section";
import type { Submission, User } from "~/lib/types";
import { formatDateTime, timeAgo } from "~/lib/format";

interface ProfileResponse {
  user: User;
  stats: {
    totalSubmissions: number;
    accepted: number;
    acceptanceRate: number;
    solvedByDifficulty: Array<{ difficulty: "EASY" | "MEDIUM" | "HARD"; solved: number; total: number }>;
  };
  recentSubmissions: Submission[];
  calendar: Array<{ day: string; n: number }>;
}

export default function ProfilePage() {
  const { username = "" } = useParams();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setError(null);
    api<ProfileResponse>(`/users/profile/${username}`)
      .then(setData)
      .catch(e => setError(e?.message || "Profile not found"));
  }, [username]);

  if (error) return <Empty title="User not found" description={error} />;
  if (!data) return <Loading />;

  const { user, stats, recentSubmissions, calendar } = data;
  const totalSolved = stats.solvedByDifficulty.reduce((acc, x) => acc + x.solved, 0);

  return (
    <div className="space-y-6">
      {/* ─── Header card ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {/* Subtle dot pattern background */}
        <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.1] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        {/* Soft edge highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        
        <div className="relative p-6 lg:p-8 flex flex-col sm:flex-row gap-6 items-start">
          <Avatar className="size-20 ring-4 ring-primary/10 shrink-0">
            <AvatarImage src={user.avatarUrl ?? undefined} alt={user.username} />
            <AvatarFallback className="text-2xl">{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{user.fullName || user.username}</h1>
              <span className="text-muted-foreground font-medium">@{user.username}</span>
            </div>
            {user.bio && <p className="mt-2 text-sm text-muted-foreground max-w-2xl line-clamp-2">{user.bio}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              {user.location && <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" /> {user.location}</span>}
              {user.website && (
                <a href={user.website} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-primary"><Globe className="size-3.5" /> {user.website.replace(/^https?:\/\//, "")}</a>
              )}
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" /> Joined {formatDateTime(user.createdAt)}</span>
            </div>
            <div className="mt-3">
              <Link
                to={`/u/${user.username}/contests`}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Trophy className="size-4" /> View contest history
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stat strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Zap} label="Solved" value={totalSolved} />
        <Stat icon={Target} label="Submissions" value={stats.totalSubmissions} />
        <Stat label="Acceptance" value={`${stats.acceptanceRate}%`} />
        <Stat icon={TrendingUp} label="Rating" value={user.rating} />
      </div>

      {/* ─── Activity + Difficulty ────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Activity calendar */}
        <div className="lg:col-span-2">
          <Section title="Activity (last 6 months)">
            <ActivityHeatmap days={calendar} />
          </Section>
        </div>

        {/* Difficulty breakdown */}
        <Section title="By difficulty">
          <div className="space-y-4">
            {stats.solvedByDifficulty.map(d => {
              const pct = d.total ? Math.round((d.solved / d.total) * 100) : 0;
              const tone = d.difficulty === "EASY" ? "bg-emerald-500" : d.difficulty === "MEDIUM" ? "bg-amber-500" : "bg-rose-500";
              return (
                <div key={d.difficulty}>
                  <div className="flex items-center justify-between text-sm">
                    <DifficultyBadge difficulty={d.difficulty} />
                    <span className="text-muted-foreground tabular-nums">
                      <span className="text-foreground font-medium">{d.solved}</span>/{d.total}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full ${tone} progress-fill rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* ─── Recent submissions ───────────────────────────────────── */}
      <Section
        title="Recent submissions"
        action={
          <Link
            to={`/submissions`}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            View all <ArrowUpRight className="size-3.5" />
          </Link>
        }
        bare
      >
        {recentSubmissions.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">No submissions yet.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {recentSubmissions.map(s => (
              <div
                key={s.id}
                className="row-accent-left px-5 py-3 flex items-center gap-3 text-sm flex-wrap"
                data-status={s.status === "ACCEPTED" ? "solved" : undefined}
              >
                <Link to={`/problems/${s.problem?.slug}`} className="font-medium hover:text-primary truncate">
                  {s.problem?.title}
                </Link>
                {s.problem && <DifficultyBadge difficulty={s.problem.difficulty} />}
                <StatusBadge status={s.status} />
                {s.language && (
                  <span className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                    {s.language}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">{timeAgo(s.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ─── Activity Heatmap ──────────────────────────────────────────────────── */

function ActivityHeatmap({ days }: { days: Array<{ day: string; n: number }> }) {
  const map = Object.fromEntries(days.map(d => [d.day, d.n]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = today;
  const start = new Date(today); start.setDate(start.getDate() - 26 * 7);
  const dayOfWeek = (d: Date) => (d.getDay() + 6) % 7; // Mon=0..Sun=6
  start.setDate(start.getDate() - dayOfWeek(start));

  const cells: { date: Date; n: number }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    cells.push({ date: new Date(d), n: map[iso] || 0 });
  }

  const intensity = (n: number) => {
    if (n === 0) return "bg-muted";
    if (n === 1) return "bg-primary/30";
    if (n === 2) return "bg-primary/55";
    if (n <= 4) return "bg-primary/75";
    return "bg-primary";
  };

  const weeks: Array<{ date: Date; n: number }[]> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // Month labels — show when the first day of a week is in a new month.
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabels: Array<{ idx: number; label: string }> = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const m = week[0].date.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ idx: wi, label: MONTH_NAMES[m] });
      lastMonth = m;
    }
  });

  return (
    <div className="overflow-x-auto scrollbar-thin">
      {/* Month labels */}
      <div className="flex gap-1 min-w-fit mb-1">
        {weeks.map((_, wi) => {
          const lbl = monthLabels.find(l => l.idx === wi);
          return (
            <div key={wi} className="w-3.5 text-center">
              {lbl && <span className="text-[9px] text-muted-foreground">{lbl.label}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 min-w-fit">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-rows-7 gap-1">
            {week.map((c, di) => (
              <div
                key={di}
                className={`size-3.5 rounded-sm ${intensity(c.n)}`}
                title={`${c.date.toISOString().slice(0, 10)}: ${c.n} submission${c.n === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        Less
        <span className="size-3 rounded-sm bg-muted" />
        <span className="size-3 rounded-sm bg-primary/30" />
        <span className="size-3 rounded-sm bg-primary/55" />
        <span className="size-3 rounded-sm bg-primary/75" />
        <span className="size-3 rounded-sm bg-primary" />
        More
      </div>
    </div>
  );
}
