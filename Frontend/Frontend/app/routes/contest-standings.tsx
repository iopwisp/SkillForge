/**
 * Contest standings leaderboard (`/contests/:slug/standings`).
 *
 * Renders the ICPC-style leaderboard served by
 * `GET /api/contests/:slug/standings`. The response is:
 *
 *   {
 *     status: 'upcoming' | 'running' | 'finished',
 *     frozen: boolean,
 *     freezeStart: string | null,
 *     standings: ContestStandingEntry[]
 *   }
 *
 * Each entry's `problems` map is keyed by numeric `problemId` (the
 * backend does not return letter labels here). To show letter-headed
 * columns we pull the contest detail (`GET /api/contests/:slug`) whose
 * problems list includes `{ id, letter, title, ... }` and build an
 * id → letter map. If `status === 'upcoming'` the detail hides titles
 * (shows `???`) but still exposes `letter` + `id`, so the column
 * layout works in every phase.
 *
 * Polling:
 *   - Only while `status === 'running'`, refetch every 15 s. When the
 *     contest goes from running → finished the interval is cleared.
 *   - `upcoming` / `finished` responses are fetched once on mount.
 *
 * Per-cell rendering (8.3):
 *   - solved         → `+<attempts>` on a green highlight row,
 *                      penalty minutes underneath; first-solve adds
 *                      a ★ badge.
 *   - attempted only → `-<attempts>` in red.
 *   - untouched      → empty cell.
 *
 * Virtual participants live in a second table so they don't pollute
 * the competitive ranking. The section is hidden when no virtual
 * participants are present.
 *
 * Implements tasks.md §20.1 / Requirements 8.1–8.5, 9.4, 9.5.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  AlertCircle, ArrowLeft, RefreshCw, Snowflake, Star, Trophy, Users,
} from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { Loading, ProtectedRoute } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "~/components/ui/table";
import type {
  ContestDetail, ContestProblemRef, ContestProblemResult,
  ContestStandingEntry, ContestStandings, ContestStatus,
} from "~/lib/teaching-types";

const POLL_INTERVAL_MS = 15_000;

export default function ContestStandingsPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [detail, setDetail] = useState<ContestDetail | null>(null);
  const [standings, setStandings] = useState<ContestStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadAll = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!slug) return;
    if (opts.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const [d, s] = await Promise.all([
        api<ContestDetail>(`/contests/${slug}`),
        api<ContestStandings>(`/contests/${slug}/standings`),
      ]);
      if (!mountedRef.current) return;
      setDetail(d);
      setStandings(s);
      if (!opts.silent) setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      if (!opts.silent) {
        setError(e instanceof ApiError ? e.message : "Could not load standings");
        setDetail(null);
        setStandings(null);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [slug]);

  // Initial load.
  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll every 15s while the contest is running. Standings during
  // `upcoming` are empty, and `finished` results don't change.
  const status = standings?.status;
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => { loadAll({ silent: true }); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, loadAll]);

  if (loading) return <Loading />;

  if (error || !detail || !standings) {
    return (
      <Empty
        icon={AlertCircle}
        title="Could not load standings"
        description={error ?? "The contest may not exist or you may not have access."}
        action={
          <Button asChild>
            <Link to={slug ? `/contests/${slug}` : "/contests"}>
              <ArrowLeft className="size-4 mr-1.5" /> Back to contest
            </Link>
          </Button>
        }
      />
    );
  }

  // Build the list of column problems in letter order. We also create
  // an `id → letter` map so each standings cell can be routed to the
  // right column. The backend keys cells by `problemId`, so without
  // this map we can't align columns to the contest's letter grid.
  const problems = [...detail.problems].sort((a, b) => a.letter.localeCompare(b.letter));
  const idToLetter = new Map<number, string>();
  for (const p of problems) {
    if (typeof p.id === "number") idToLetter.set(p.id, p.letter);
  }

  const liveEntries = standings.standings.filter(e => !e.isVirtual);
  const virtualEntries = standings.standings.filter(e => e.isVirtual);

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
            <Link to={`/contests/${detail.slug}`}><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight truncate flex items-center gap-2">
              <Trophy className="size-6 text-primary shrink-0" />
              Standings
            </h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              <span className="truncate">{detail.title}</span>
              <span>·</span>
              <StatusBadge status={standings.status} />
              <span>·</span>
              <span className="flex items-center gap-1">
                <Users className="size-3" /> {standings.standings.length} participant{standings.standings.length === 1 ? "" : "s"}
              </span>
              {refreshing && (
                <span className="flex items-center gap-1 text-xs">
                  <RefreshCw className="size-3 animate-spin" /> updating…
                </span>
              )}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadAll({ silent: true })}
          disabled={refreshing}
        >
          <RefreshCw className={`size-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {standings.frozen && (
        <FrozenBanner freezeStart={standings.freezeStart} />
      )}

      {liveEntries.length === 0 && virtualEntries.length === 0 ? (
        <Empty
          icon={Trophy}
          title="No participants yet"
          description={
            standings.status === "upcoming"
              ? "Standings will populate once the contest starts and participants submit solutions."
              : "No submissions have been made in this contest yet."
          }
        />
      ) : (
        <div className="space-y-8">
          <StandingsSection
            title="Live standings"
            entries={liveEntries}
            problems={problems}
            idToLetter={idToLetter}
          />
          {virtualEntries.length > 0 && (
            <StandingsSection
              title="Virtual participants"
              entries={virtualEntries}
              problems={problems}
              idToLetter={idToLetter}
              virtual
            />
          )}
        </div>
      )}
    </>
  );
}

/* ─── frozen banner ─────────────────────────────────────────────────────── */

function FrozenBanner({ freezeStart }: { freezeStart: string | null }) {
  return (
    <div className="mb-5 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 flex items-start gap-3">
      <div className="rounded-lg bg-sky-500/15 p-2 shrink-0">
        <Snowflake className="size-4 text-sky-500" />
      </div>
      <div className="min-w-0 text-sm">
        <div className="font-medium">Standings are frozen</div>
        <p className="text-muted-foreground mt-0.5">
          Submissions made after{freezeStart ? ` ${new Date(freezeStart).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : " the freeze point"} are hidden until the contest ends. The live view will refresh automatically when results unfreeze.
        </p>
      </div>
    </div>
  );
}

/* ─── section + table ──────────────────────────────────────────────────── */

function StandingsSection({
  title, entries, problems, idToLetter, virtual,
}: {
  title: string;
  entries: ContestStandingEntry[];
  problems: ContestProblemRef[];
  idToLetter: Map<number, string>;
  virtual?: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
        {title}
        <span className="text-xs text-muted-foreground/70">({entries.length})</span>
        {virtual && (
          <Badge variant="outline" className="text-[10px] h-5">Virtual</Badge>
        )}
      </h2>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="w-16 text-center">Solved</TableHead>
              <TableHead className="w-20 text-center">Penalty</TableHead>
              {problems.map(p => (
                <TableHead key={p.letter} className="w-20 text-center font-mono">
                  {p.letter}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(entry => (
              <StandingsRow
                key={entry.participationId}
                entry={entry}
                problems={problems}
                idToLetter={idToLetter}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function StandingsRow({
  entry, problems, idToLetter,
}: {
  entry: ContestStandingEntry;
  problems: ContestProblemRef[];
  idToLetter: Map<number, string>;
}) {
  // Re-key entry.problems by letter so cell lookup matches the column
  // header. Any keys that don't map to a column letter are ignored —
  // this should never happen in practice but guards against a stale
  // contest detail response.
  const byLetter = new Map<string, ContestProblemResult>();
  for (const [problemIdStr, result] of Object.entries(entry.problems)) {
    const letter = idToLetter.get(Number(problemIdStr));
    if (letter) byLetter.set(letter, result);
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {entry.rank}
      </TableCell>
      <TableCell>
        <Link
          to={`/u/${entry.username}`}
          className="font-medium hover:text-primary transition-colors"
        >
          {entry.username}
        </Link>
      </TableCell>
      <TableCell className="text-center font-semibold">
        {entry.solvedCount}
      </TableCell>
      <TableCell className="text-center text-muted-foreground">
        {entry.penaltyTime}
      </TableCell>
      {problems.map(p => {
        const cell = byLetter.get(p.letter);
        return <ProblemCell key={p.letter} cell={cell} />;
      })}
    </TableRow>
  );
}

function ProblemCell({ cell }: { cell: ContestProblemResult | undefined }) {
  if (!cell || cell.attempts === 0) {
    return <TableCell className="text-center text-muted-foreground/50">—</TableCell>;
  }

  const solved = cell.acceptedAt !== null;

  if (solved) {
    const cls = cell.isFirstSolve
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    return (
      <TableCell className={`text-center ${cls}`}>
        <div className="flex items-center justify-center gap-1 font-mono text-sm font-semibold">
          {cell.isFirstSolve && <Star className="size-3 fill-current" />}
          +{cell.attempts}
        </div>
        <div className="text-[10px] font-mono opacity-70">
          {cell.penaltyMinutes}
        </div>
      </TableCell>
    );
  }

  // Attempted but not yet accepted (includes pending ones during a
  // freeze — the backend increments `attempts` but hides the verdict,
  // which surfaces here as "attempted, not solved").
  return (
    <TableCell className="text-center text-rose-500/80">
      <div className="font-mono text-sm">-{cell.attempts}</div>
    </TableCell>
  );
}

/* ─── misc ─────────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: ContestStatus }) {
  const cls =
    status === "running"  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
    status === "upcoming" ? "bg-sky-500/10 text-sky-500 border-sky-500/20" :
                            "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cls}>
      {status === "running" ? "Live" : status === "upcoming" ? "Upcoming" : "Finished"}
    </Badge>
  );
}
