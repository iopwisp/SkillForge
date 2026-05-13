import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { MapPin, Globe, CalendarDays, Trophy } from "lucide-react";
import { api } from "~/lib/api";
import { Loading } from "~/lib/guards";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { Empty } from "~/components/common/Empty";
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
    <>
      {/* Header card */}
      <div className="rounded-2xl border border-border bg-card p-6 lg:p-8 flex flex-col sm:flex-row gap-6 items-start">
        <Avatar className="size-24 ring-4 ring-primary/10">
          <AvatarImage src={user.avatarUrl ?? undefined} alt={user.username} />
          <AvatarFallback className="text-2xl">{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{user.fullName || user.username}</h1>
            <span className="text-muted-foreground">@{user.username}</span>
          </div>
          {user.bio && <p className="mt-2 text-sm text-muted-foreground max-w-2xl">{user.bio}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {user.location && <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" /> {user.location}</span>}
            {user.website && (
              <a href={user.website} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-primary"><Globe className="size-3.5" /> {user.website.replace(/^https?:\/\//, "")}</a>
            )}
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" /> Joined {formatDateTime(user.createdAt)}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Stat label="Solved" value={totalSolved} />
            <Stat label="Submissions" value={stats.totalSubmissions} />
            <Stat label="Acceptance" value={`${stats.acceptanceRate}%`} />
            <Stat label="Rating" value={user.rating} accent />
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

      <div className="mt-6 grid lg:grid-cols-3 gap-5">
        {/* Activity calendar */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">Activity (last 6 months)</h2>
          <ActivityHeatmap days={calendar} />
        </div>

        {/* Difficulty breakdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">By difficulty</h2>
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
                    <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent submissions */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold mb-4">Recent submissions</h2>
        {recentSubmissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          <ul className="divide-y divide-border -my-2">
            {recentSubmissions.map(s => (
              <li key={s.id} className="py-3 flex items-center gap-3 text-sm flex-wrap">
                <Link to={`/problems/${s.problem?.slug}`} className="font-medium hover:text-primary truncate">
                  {s.problem?.title}
                </Link>
                {s.problem && <DifficultyBadge difficulty={s.problem.difficulty} />}
                <StatusBadge status={s.status} />
                <span className="ml-auto text-xs text-muted-foreground">{timeAgo(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${accent ? "gradient-text" : ""}`}>{value}</div>
    </div>
  );
}

function ActivityHeatmap({ days }: { days: Array<{ day: string; n: number }> }) {
  // Build a map of day → count
  const map = Object.fromEntries(days.map(d => [d.day, d.n]));
  // 26 weeks (≈6 months) × 7 days
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = today;
  const start = new Date(today); start.setDate(start.getDate() - 26 * 7);
  // Align start to Monday
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

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="flex gap-1 min-w-fit">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-rows-7 gap-1">
            {week.map((c, di) => (
              <div
                key={di}
                className={`size-3 rounded-sm ${intensity(c.n)}`}
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
