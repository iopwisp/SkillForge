/**
 * Leaderboard — top solvers by rating.
 *
 * Overhaul v1:
 *   - Podium cards use `card-interactive` with consistent styling.
 *   - Table uses flexbox rows (not grid-cols-12) + `row-accent-left` for the
 *     current user's row highlight.
 *   - Consistent typography and spacing.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Crown, Medal, Trophy } from "lucide-react";
import { api } from "~/lib/api";
import type { LeaderboardEntry } from "~/lib/types";
import { PageHeader } from "~/components/common/PageHeader";
import { LoadingSkeleton } from "~/components/common/LoadingSkeleton";
import { Empty } from "~/components/common/Empty";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { useAuth } from "~/lib/auth";
import { cn } from "~/components/ui/utils";

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
        <LoadingSkeleton rows={8} withHeader={false} />
      ) : list.length === 0 ? (
        <Empty
          icon={Trophy}
          title="Leaderboard is empty"
          description="Rankings will appear after the first accepted submissions."
        />
      ) : (
        <>
          {/* Podium */}
          {showPodium && (
            <div className="grid grid-cols-3 gap-3 sm:gap-5 mb-8">
              {/* Order: 2nd, 1st, 3rd for visual podium */}
              {[top3[1], top3[0], top3[2]].filter(Boolean).map((u) => {
                const isFirst = u.rank === 1;
                const isSecond = u.rank === 2;
                const accent = isFirst ? "border-amber-500/30" : isSecond ? "border-zinc-400/30" : "border-orange-700/30";
                const iconColor = isFirst ? "text-amber-500" : isSecond ? "text-zinc-400" : "text-orange-700";
                const Icon = isFirst ? Crown : isSecond ? Medal : Trophy;
                const heightClass = isFirst ? "pt-8 pb-10" : "pt-12 pb-8";
                return (
                  <Link key={u.id} to={`/u/${u.username}`}
                    className={cn(
                      "card-interactive flex flex-col items-center text-center px-3 sm:px-5",
                      accent,
                      heightClass,
                    )}
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
                    <Icon className={cn("mt-3 size-5", iconColor)} />
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
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
              <div className="hidden sm:flex items-center gap-4 px-4 py-3 border-b border-border/60 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted/30">
                <div className="w-12">Rank</div>
                <div className="flex-1">User</div>
                <div className="w-20 text-right">Solved</div>
                <div className="w-20 text-right">Rating</div>
              </div>
              <ul className="divide-y divide-border/40">
                {tableRows.map(u => (
                  <li
                    key={u.id}
                    className={cn(
                      "row-accent-left",
                      user?.id === u.id && "!bg-primary/5",
                    )}
                  >
                    <Link
                      to={`/u/${u.username}`}
                      className="flex items-center gap-4 px-4 py-2.5 text-sm"
                    >
                      <div className="w-12 font-mono text-muted-foreground tabular-nums">#{u.rank}</div>
                      <div className="flex-1 flex items-center gap-3 min-w-0">
                        <Avatar className="size-8 shrink-0">
                          <AvatarImage src={u.avatarUrl ?? undefined} alt={u.username} />
                          <AvatarFallback>{u.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <span className="font-medium hover:text-primary truncate block">
                            {u.username} {user?.id === u.id && <span className="text-xs text-primary">(you)</span>}
                          </span>
                          {u.fullName && <span className="text-xs text-muted-foreground truncate block">{u.fullName}</span>}
                        </div>
                      </div>
                      <div className="w-20 text-right tabular-nums">{u.solved}</div>
                      <div className="w-20 text-right font-semibold tabular-nums">{u.rating}</div>
                    </Link>
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
