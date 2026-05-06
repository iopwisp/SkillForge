import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Crown, Medal, Trophy } from "lucide-react";
import { api } from "~/lib/api";
import type { LeaderboardEntry } from "~/lib/types";
import { PageHeader } from "~/components/common/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { useAuth } from "~/lib/auth";

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [list, setList] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<LeaderboardEntry[]>("/users/leaderboard").then(setList).finally(() => setLoading(false));
  }, []);

  const top3 = list.slice(0, 3);
  const rest = list.slice(3);
  const showPodium = top3.length === 3;
  const tableRows = showPodium ? rest : list;

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="Top SkillForge solvers by rating. Earn rating by solving problems — harder problems are worth more."
      />

      {loading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <h2 className="text-lg font-semibold">Leaderboard is empty</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Rankings will appear after the first accepted submissions.
          </p>
        </div>
      ) : (
        <>
          {/* Podium */}
          {showPodium && (
            <div className="grid grid-cols-3 gap-3 sm:gap-5 mb-8">
              {/* Order: 2nd, 1st, 3rd for visual podium */}
              {[top3[1], top3[0], top3[2]].filter(Boolean).map((u, i) => {
                const isFirst = u.rank === 1;
                const isSecond = u.rank === 2;
                const tone = isFirst ? "from-amber-500/40 to-amber-500/5 ring-amber-500/40"
                           : isSecond ? "from-zinc-400/40 to-zinc-400/5 ring-zinc-400/40"
                           : "from-orange-700/40 to-orange-700/5 ring-orange-700/40";
                const Icon = isFirst ? Crown : isSecond ? Medal : Trophy;
                const heightClass = isFirst ? "pt-8 pb-10" : "pt-12 pb-8";
                return (
                  <Link key={u.id} to={`/u/${u.username}`}
                    className={`rounded-2xl border border-border bg-gradient-to-b ${tone} ring-1 ${heightClass} px-3 sm:px-5 flex flex-col items-center text-center hover:border-primary/40 transition-colors`}
                  >
                    <div className="relative">
                      <Avatar className="size-16 sm:size-20 border-2 border-background">
                        <AvatarImage src={u.avatarUrl ?? undefined} alt={u.username} />
                        <AvatarFallback className="text-lg">{u.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="absolute -top-2 -right-2 size-7 rounded-full bg-card border border-border flex items-center justify-center text-xs font-bold">
                        {u.rank}
                      </span>
                    </div>
                    <Icon className={`mt-3 size-5 ${isFirst ? "text-amber-500" : isSecond ? "text-zinc-400" : "text-orange-700"}`} />
                    <h3 className="mt-1 font-semibold truncate max-w-full">{u.username}</h3>
                    {u.fullName && <p className="text-xs text-muted-foreground truncate max-w-full">{u.fullName}</p>}
                    <p className="mt-2 text-xl sm:text-2xl font-bold tabular-nums">{u.rating}</p>
                    <p className="text-[11px] text-muted-foreground">{u.solved} solved</p>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Table */}
          {tableRows.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="grid grid-cols-12 gap-4 px-4 py-2.5 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <div className="col-span-1">Rank</div>
                <div className="col-span-7">User</div>
                <div className="col-span-2 text-right">Solved</div>
                <div className="col-span-2 text-right">Rating</div>
              </div>
              <ul className="divide-y divide-border">
                {tableRows.map(u => (
                  <li
                    key={u.id}
                    className={`grid grid-cols-12 gap-4 px-4 py-2.5 hover:bg-accent/40 transition-colors ${user?.id === u.id ? "bg-primary/5" : ""}`}
                  >
                    <div className="col-span-1 font-mono text-sm text-muted-foreground tabular-nums">#{u.rank}</div>
                    <div className="col-span-7 flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={u.avatarUrl ?? undefined} alt={u.username} />
                        <AvatarFallback>{u.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Link to={`/u/${u.username}`} className="text-sm font-medium hover:text-primary truncate block">
                          {u.username} {user?.id === u.id && <span className="text-xs text-primary">(you)</span>}
                        </Link>
                        {u.fullName && <span className="text-xs text-muted-foreground truncate">{u.fullName}</span>}
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center justify-end text-sm tabular-nums">{u.solved}</div>
                    <div className="col-span-2 flex items-center justify-end text-sm font-semibold tabular-nums">{u.rating}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
