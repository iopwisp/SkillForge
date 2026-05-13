/**
 * Contest history + rating for a user (`/u/:username/contests`).
 *
 * Pulls from two backend endpoints, both exposed in `app.js`:
 *   - GET /api/users/:username/contests        → UserContestHistoryEntry[]
 *   - GET /api/users/:username/contest-rating  → UserContestRating
 *
 * Layout:
 *   - Header with current Glicko-2 rating + contests-played count.
 *   - Rating graph: inline SVG line chart of `newRating` over time
 *     (rated contests only — virtual / unrated rows don't appear).
 *   - Table of every participation (live or virtual) with rank, solved
 *     count, rating change, and post-contest rating.
 *
 * No chart library is used. Recharts is installed in the project for
 * other surfaces, but an inline SVG line chart keeps this page small,
 * avoids theme/tooltip plumbing, and matches the task's "simplicity
 * first" guidance.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { AlertCircle, Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "~/components/ui/table";
import type {
  UserContestHistoryEntry,
  UserContestRating,
} from "~/lib/teaching-types";
import { formatDateTime } from "~/lib/format";

export default function ProfileContestsPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const { username = "" } = useParams<{ username: string }>();
  const [history, setHistory] = useState<UserContestHistoryEntry[] | null>(null);
  const [rating, setRating] = useState<UserContestRating | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setHistory(null);
    setRating(null);

    Promise.all([
      api<UserContestHistoryEntry[]>(`/users/${encodeURIComponent(username)}/contests`),
      api<UserContestRating>(`/users/${encodeURIComponent(username)}/contest-rating`),
    ])
      .then(([h, r]) => {
        if (!active) return;
        setHistory(h);
        setRating(r);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof ApiError ? e.message : "Could not load contest history");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [username]);

  if (loading) return <Loading />;

  if (error || !history || !rating) {
    return (
      <Empty
        icon={AlertCircle}
        title="Could not load contest history"
        description={error ?? "This user may not exist."}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/u/${username}`}>Back to profile</Link>
          </Button>
        }
      />
    );
  }

  const hasAnyHistory = history.length > 0;
  const hasRating = rating.rating !== null && rating.contestsPlayed > 0;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Trophy className="size-6 text-primary" />
            Contest history
          </span>
        }
        description={
          <>
            Competitive participation for{" "}
            <Link to={`/u/${username}`} className="font-medium hover:text-primary">
              @{username}
            </Link>
            .
          </>
        }
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/u/${username}`}>Back to profile</Link>
          </Button>
        }
      />

      {/* Current rating card */}
      <div className="mb-6 rounded-xl border border-border bg-card p-5 flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Current rating
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-3xl font-bold tabular-nums ${hasRating ? "gradient-text" : "text-muted-foreground"}`}>
              {hasRating ? Math.round(rating.rating as number) : "—"}
            </span>
            {hasRating && rating.ratingDeviation !== null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                ± {Math.round(rating.ratingDeviation)}
              </span>
            )}
          </div>
        </div>
        <div className="h-10 w-px bg-border" />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Rated contests
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {rating.contestsPlayed}
          </div>
        </div>
        {rating.lastContestAt && (
          <>
            <div className="h-10 w-px bg-border" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Last contest
              </div>
              <div className="mt-1 text-sm">{formatDateTime(rating.lastContestAt)}</div>
            </div>
          </>
        )}
      </div>

      {/* Rating graph */}
      {rating.history.length >= 1 ? (
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold mb-4">Rating over time</h2>
          <RatingChart history={rating.history} />
        </div>
      ) : null}

      {/* History table */}
      {hasAnyHistory ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contest</TableHead>
                <TableHead className="w-32">Date</TableHead>
                <TableHead className="w-20 text-center">Rank</TableHead>
                <TableHead className="w-20 text-center">Solved</TableHead>
                <TableHead className="w-28 text-center">Rating Δ</TableHead>
                <TableHead className="w-24 text-center">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <HistoryRow key={`${h.contestSlug}-${h.date}-${h.isVirtual}`} entry={h} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Empty
          icon={Trophy}
          title="No contest history yet"
          description={
            <>
              @{username} hasn't participated in any contest.{" "}
              <Link to="/contests" className="text-primary hover:underline">
                Browse upcoming contests
              </Link>
              .
            </>
          }
        />
      )}
    </>
  );
}

/* ─── History row ─────────────────────────────────────────────────────── */

function HistoryRow({ entry }: { entry: UserContestHistoryEntry }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to={`/contests/${entry.contestSlug}`}
            className="font-medium hover:text-primary truncate"
          >
            {entry.contestTitle}
          </Link>
          {entry.isVirtual && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              Virtual
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {formatDateTime(entry.date)}
      </TableCell>
      <TableCell className="text-center font-mono tabular-nums">
        {entry.rank !== null ? entry.rank : "—"}
      </TableCell>
      <TableCell className="text-center font-mono tabular-nums">
        {entry.solvedCount}
      </TableCell>
      <TableCell className="text-center">
        <RatingDelta delta={entry.ratingChange} />
      </TableCell>
      <TableCell className="text-center font-mono tabular-nums">
        {entry.newRating !== null ? Math.round(entry.newRating) : "—"}
      </TableCell>
    </TableRow>
  );
}

function RatingDelta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const rounded = Math.round(delta);
  if (rounded > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
        <TrendingUp className="size-3.5" />+{rounded}
      </span>
    );
  }
  if (rounded < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-rose-500 font-medium tabular-nums">
        <TrendingDown className="size-3.5" />
        {rounded}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
      <Minus className="size-3.5" />0
    </span>
  );
}

/* ─── Inline SVG rating chart ─────────────────────────────────────────── */

interface ChartPoint {
  date: string;
  rating: number;
}

function RatingChart({
  history,
}: {
  history: Array<{ contestTitle: string; date: string; newRating: number }>;
}) {
  // Sort chronologically so the line reads left → right.
  const points: ChartPoint[] = useMemo(() => {
    return [...history]
      .map((h) => ({ date: h.date, rating: h.newRating }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [history]);

  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) return null;

  // Layout
  const width = 640;
  const height = 220;
  const padL = 44;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Single point: show a degenerate chart with just the dot.
  const ratings = points.map((p) => p.rating);
  const minR = Math.min(...ratings);
  const maxR = Math.max(...ratings);
  // Pad the y range a touch so the line never hugs the top/bottom.
  const rangePad = Math.max(50, (maxR - minR) * 0.15);
  const yMin = Math.floor((minR - rangePad) / 10) * 10;
  const yMax = Math.ceil((maxR + rangePad) / 10) * 10;
  const ySpan = Math.max(yMax - yMin, 1);

  const times = points.map((p) => new Date(p.date).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = Math.max(tMax - tMin, 1);

  const xOf = (t: number) =>
    points.length === 1 ? padL + plotW / 2 : padL + ((t - tMin) / tSpan) * plotW;
  const yOf = (r: number) => padT + (1 - (r - yMin) / ySpan) * plotH;

  const pathD = points
    .map((p, i) => {
      const x = xOf(new Date(p.date).getTime());
      const y = yOf(p.rating);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Area under the line (subtle fill).
  const areaD =
    points.length > 1
      ? `${pathD} L${xOf(tMax).toFixed(1)},${(padT + plotH).toFixed(1)} L${xOf(tMin).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
      : "";

  // Gridlines — 4 horizontal ticks.
  const ticks = 4;
  const gridYs = Array.from({ length: ticks + 1 }, (_, i) => {
    const r = yMin + ((yMax - yMin) * i) / ticks;
    return { y: yOf(r), label: Math.round(r) };
  });

  return (
    <div className="w-full">
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          role="img"
          aria-label="Rating over time"
          preserveAspectRatio="none"
        >
          {/* Y-axis gridlines + labels */}
          {gridYs.map((g, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={width - padR}
                y1={g.y}
                y2={g.y}
                className="stroke-border"
                strokeDasharray="2 3"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={g.y + 3}
                className="fill-muted-foreground text-[10px]"
                textAnchor="end"
              >
                {g.label}
              </text>
            </g>
          ))}

          {/* X-axis baseline */}
          <line
            x1={padL}
            x2={width - padR}
            y1={padT + plotH}
            y2={padT + plotH}
            className="stroke-border"
            strokeWidth={1}
          />

          {/* Area fill (only when we have ≥2 points) */}
          {areaD && (
            <path
              d={areaD}
              className="fill-primary/10"
            />
          )}

          {/* Line */}
          <path
            d={pathD}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Points */}
          {points.map((p, i) => {
            const x = xOf(new Date(p.date).getTime());
            const y = yOf(p.rating);
            const isHovered = hover === i;
            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? 5 : 3.5}
                  className="fill-primary stroke-background"
                  strokeWidth={2}
                />
                {/* Wider transparent hit-target for easier hovering. */}
                <circle
                  cx={x}
                  cy={y}
                  r={12}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer" }}
                />
              </g>
            );
          })}

          {/* X-axis endpoint labels */}
          {points.length > 0 && (
            <>
              <text
                x={xOf(tMin)}
                y={height - 8}
                className="fill-muted-foreground text-[10px]"
                textAnchor="start"
              >
                {new Date(points[0].date).toLocaleDateString()}
              </text>
              {points.length > 1 && (
                <text
                  x={xOf(tMax)}
                  y={height - 8}
                  className="fill-muted-foreground text-[10px]"
                  textAnchor="end"
                >
                  {new Date(points[points.length - 1].date).toLocaleDateString()}
                </text>
              )}
            </>
          )}
        </svg>

        {/* Tooltip */}
        {hover !== null && (
          <HoverTip
            point={points[hover]}
            x={xOf(new Date(points[hover].date).getTime())}
            y={yOf(points[hover].rating)}
            width={width}
            height={height}
          />
        )}
      </div>
    </div>
  );
}

function HoverTip({
  point,
  x,
  y,
  width,
  height,
}: {
  point: ChartPoint;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  // Translate SVG coordinates to CSS percentages so the tooltip tracks
  // the responsive width of the containing element.
  const leftPct = (x / width) * 100;
  const topPct = (y / height) * 100;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover text-popover-foreground shadow-md px-2.5 py-1.5 text-xs"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: "translate(-50%, calc(-100% - 10px))",
      }}
    >
      <div className="font-mono font-semibold tabular-nums">{Math.round(point.rating)}</div>
      <div className="text-muted-foreground text-[10px] whitespace-nowrap">
        {new Date(point.date).toLocaleDateString()}
      </div>
    </div>
  );
}
