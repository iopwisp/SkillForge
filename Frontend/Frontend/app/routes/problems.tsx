/**
 * Problems catalogue page.
 *
 * Overhaul v1 — clean coding-platform feel:
 *   - Cleaner header: no stats grid at top (was noisy).
 *   - Merged filter toolbar: search, chips, category, view toggle in one bar.
 *   - Table view: flexbox rows, left status-accent border, inline acceptance bars.
 *   - Grid view: card-interactive cards.
 *   - No row numbers (was visual noise).
 *
 * All filters stored in URLSearchParams — shareable and back/forward works.
 * Zero backend changes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Check,
  CircleDashed,
  CircleDotDashed,
  Search,
  Filter,
  X,
  Star,
  Shuffle,
  LayoutGrid,
  Rows3,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import type { Category, ProblemSummary } from "~/lib/types";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { Empty } from "~/components/common/Empty";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { formatNumber } from "~/lib/format";
import { cn } from "~/components/ui/utils";

const DIFFICULTY_CHIPS = [
  { value: "all", label: "All" },
  { value: "EASY", label: "Easy" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HARD", label: "Hard" },
];

const STATUS_CHIPS = [
  { value: "all", label: "Any" },
  { value: "todo", label: "Todo" },
  { value: "attempted", label: "Attempted" },
  { value: "solved", label: "Solved" },
];

const TYPE_CHIPS = [
  { value: "all", label: "All" },
  { value: "ALGORITHM", label: "Algorithm" },
  { value: "BACKEND", label: "Backend" },
  { value: "FRONTEND", label: "Frontend" },
  { value: "SQL", label: "SQL" },
  { value: "STDIO", label: "STDIO" },
];

const TYPE_PILL_CLASS: Record<string, string> = {
  ALGORITHM: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  BACKEND: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  FRONTEND: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  SQL: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  STDIO: "bg-amber-500/10 text-amber-500 border-amber-500/20",
};

export default function ProblemsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const search = params.get("search") || "";
  const difficulty = params.get("difficulty") || "all";
  const category = params.get("category") || "all";
  const status = params.get("status") || "all";
  const type = params.get("type") || "all";
  const view = (params.get("view") || "list") as "list" | "grid";

  const [searchInput, setSearchInput] = useState(search);
  // Keep local input in sync with URL when filters are reset externally.
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Debounce search → URL. Avoids a request on every keystroke.
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchInput === search) return;
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setParam("search", searchInput.trim());
    }, 250);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    api<Category[]>("/categories").then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (difficulty !== "all") qs.set("difficulty", difficulty);
    if (category !== "all") qs.set("category", category);
    if (status !== "all") qs.set("status", status);
    if (type !== "all") qs.set("type", type);
    qs.set("pageSize", "200");
    api<{ items: ProblemSummary[]; total: number }>(`/problems?${qs}`)
      .then((r) => setItems(r.items))
      .finally(() => setLoading(false));
  }, [search, difficulty, category, status, type]);

  function setParam(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (!v || v === "all") p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  }

  function clearFilters() {
    const p = new URLSearchParams();
    // Preserve the view preference across "clear".
    if (view !== "list") p.set("view", view);
    setParams(p, { replace: true });
    setSearchInput("");
  }

  async function toggleFavorite(slug: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error("Sign in to save favourites");
      return;
    }
    setItems((list) =>
      list.map((p) => (p.slug === slug ? { ...p, favorited: !p.favorited } : p)),
    );
    try {
      await api(`/problems/${slug}/favorite`, { method: "POST" });
    } catch {
      toast.error("Could not update favourite");
      setItems((list) =>
        list.map((p) => (p.slug === slug ? { ...p, favorited: !p.favorited } : p)),
      );
    }
  }

  function pickRandom() {
    if (items.length === 0) return;
    const p = items[Math.floor(Math.random() * items.length)];
    window.location.assign(`/problems/${p.slug}`);
  }

  const totals = useMemo(
    () => ({
      all: items.length,
      solved: items.filter((p) => p.status === "solved").length,
    }),
    [items],
  );

  const hasFilters = !!(
    search ||
    difficulty !== "all" ||
    category !== "all" ||
    status !== "all" ||
    type !== "all"
  );

  return (
    <div className="space-y-5">
      {/* ─── Header ────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Problems</h1>
          <p className="mt-1.5 text-sm text-muted-foreground font-medium">
            {totals.all > 0 ? (
              <>
                {totals.all} problem{totals.all === 1 ? "" : "s"}
                {user && totals.solved > 0 && (
                  <> · <span className="text-foreground font-medium">{totals.solved}</span> solved</>
                )}
              </>
            ) : (
              user ? "Browse the catalogue and pick your next challenge." : "Browse the catalogue — sign in to track progress."
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={pickRandom} disabled={items.length === 0}>
            <Shuffle className="size-4" /> Random
          </Button>
        </div>
      </div>

      {/* ─── Filters ───────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Search + category + density toggle row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title or tag…"
              className="pl-9 bg-input-background rounded-full"
            />
          </div>
          <Select value={category} onValueChange={(v) => setParam("category", v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="inline-flex rounded-md border border-border/60 bg-card overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setParam("view", "list")}
              aria-pressed={view === "list"}
              aria-label="List view"
              className={cn(
                "px-2.5 py-1.5 transition-colors",
                view === "list"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
              )}
            >
              <Rows3 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setParam("view", "grid")}
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              className={cn(
                "px-2.5 py-1.5 border-l border-border transition-colors",
                view === "grid"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
        </div>

        {/* Chip rows */}
        <ChipRow label="Difficulty">
          {DIFFICULTY_CHIPS.map((c) => (
            <Chip
              key={c.value}
              active={difficulty === c.value}
              onClick={() => setParam("difficulty", c.value)}
            >
              {c.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Type">
          {TYPE_CHIPS.map((c) => (
            <Chip
              key={c.value}
              active={type === c.value}
              onClick={() => setParam("type", c.value)}
            >
              {c.label}
            </Chip>
          ))}
        </ChipRow>
        {user && (
          <ChipRow label="Status">
            {STATUS_CHIPS.map((c) => (
              <Chip
                key={c.value}
                active={status === c.value}
                onClick={() => setParam("status", c.value)}
              >
                {c.label}
              </Chip>
            ))}
          </ChipRow>
        )}
        {hasFilters && (
          <div>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5" /> Clear filters
            </Button>
          </div>
        )}
      </div>

      {/* ─── Results ───────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty
          icon={Filter}
          title="No problems match your filters"
          description="Try clearing some filters or broadening the search."
          action={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : view === "grid" ? (
        <ProblemsGrid items={items} onFavorite={toggleFavorite} />
      ) : (
        <ProblemsTable items={items} onFavorite={toggleFavorite} />
      )}
    </div>
  );
}

/* ─── Chips ─────────────────────────────────────────────────────────────── */

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest w-[70px] shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-state={active ? "active" : undefined}
      className="chip transition-colors"
    >
      {children}
    </button>
  );
}

/* ─── List (table) view ─────────────────────────────────────────────────── */

function ProblemsTable({
  items,
  onFavorite,
}: {
  items: ProblemSummary[];
  onFavorite: (slug: string, e: React.MouseEvent) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
      {/* Column header */}
      <div className="hidden sm:flex items-center gap-4 px-4 py-3 border-b border-border/60 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted/30">
        <div className="w-5 shrink-0" />
        <div className="flex-1 min-w-0">Title</div>
        <div className="w-20 text-center">Difficulty</div>
        <div className="w-28">Acceptance</div>
        <div className="w-24 text-right">Submissions</div>
        <div className="w-8" />
      </div>

      <ul className="divide-y divide-border/40">
        {items.map((p) => (
          <li
            key={p.id}
            className="row-accent-left"
            data-status={p.status === "solved" ? "solved" : p.status === "attempted" ? "attempted" : undefined}
          >
            <Link
              to={`/problems/${p.slug}`}
              className="flex items-center gap-4 px-4 py-3 text-sm"
            >
              {/* Status dot */}
              <div className="w-5 flex items-center justify-center shrink-0">
                <StatusDot status={p.status} />
              </div>

              {/* Title + tags */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate hover:text-primary">
                    {p.title}
                  </span>
                  {p.problemType && p.problemType !== "ALGORITHM" && (
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                        TYPE_PILL_CLASS[p.problemType] || "",
                      )}
                    >
                      {p.problemType}
                    </span>
                  )}
                </div>
                <div className="mt-1 hidden sm:flex gap-1 flex-wrap">
                  {p.tags.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div className="w-20 hidden sm:flex justify-center">
                <DifficultyBadge difficulty={p.difficulty} />
              </div>

              {/* Acceptance — inline mini bar */}
              <div className="w-28 hidden sm:flex items-center">
                <span className="acceptance-bar">
                  <span className="text-xs text-muted-foreground tabular-nums">{p.acceptanceRate}%</span>
                  <span className="acceptance-bar-track">
                    <span
                      className="acceptance-bar-fill"
                      style={{ width: `${p.acceptanceRate}%` }}
                    />
                  </span>
                </span>
              </div>

              {/* Submissions */}
              <div className="w-24 hidden sm:flex items-center justify-end text-sm text-muted-foreground tabular-nums">
                {formatNumber(p.totalSubmissions)}
              </div>

              {/* Favorite */}
              <div className="w-8 flex items-center justify-center shrink-0">
                <button
                  onClick={(e) => onFavorite(p.slug, e)}
                  className={cn(
                    "p-1 rounded text-xs transition-colors",
                    p.favorited
                      ? "text-amber-500"
                      : "text-muted-foreground hover:text-amber-500",
                  )}
                  title={p.favorited ? "Remove from favourites" : "Add to favourites"}
                  aria-label="Toggle favourite"
                >
                  <Star
                    className={cn("size-3.5", p.favorited && "fill-current")}
                  />
                </button>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Grid (card) view ──────────────────────────────────────────────────── */

function ProblemsGrid({
  items,
  onFavorite,
}: {
  items: ProblemSummary[];
  onFavorite: (slug: string, e: React.MouseEvent) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <Link
          key={p.id}
          to={`/problems/${p.slug}`}
          className="group flex flex-col card-interactive p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot status={p.status} />
              <span className="font-medium truncate group-hover:text-primary">
                {p.title}
              </span>
            </div>
            <button
              onClick={(e) => onFavorite(p.slug, e)}
              className={cn(
                "p-1 -m-1 rounded text-xs transition-colors shrink-0",
                p.favorited
                  ? "text-amber-500"
                  : "text-muted-foreground hover:text-amber-500",
              )}
              aria-label="Toggle favourite"
            >
              <Star className={cn("size-3.5", p.favorited && "fill-current")} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <DifficultyBadge difficulty={p.difficulty} />
            {p.problemType && p.problemType !== "ALGORITHM" && (
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                  TYPE_PILL_CLASS[p.problemType] || "",
                )}
              >
                {p.problemType}
              </span>
            )}
            {p.category && (
              <span className="text-[11px] text-muted-foreground">
                {p.category.name}
              </span>
            )}
          </div>
          {p.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {p.tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="mt-auto pt-4 border-t border-border/40 text-[11px] text-muted-foreground flex items-center justify-between tabular-nums">
            <span className="acceptance-bar">
              <span>{p.acceptanceRate}% accepted</span>
              <span className="acceptance-bar-track">
                <span
                  className="acceptance-bar-fill"
                  style={{ width: `${p.acceptanceRate}%` }}
                />
              </span>
            </span>
            <span>{formatNumber(p.totalSubmissions)} subs</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ─── Misc ──────────────────────────────────────────────────────────────── */

function StatusDot({ status }: { status: ProblemSummary["status"] }) {
  if (status === "solved") {
    return (
      <span
        className="inline-flex items-center justify-center size-5 rounded-full bg-emerald-500 text-white"
        title="Solved"
      >
        <Check className="size-3" />
      </span>
    );
  }
  if (status === "attempted") {
    return <CircleDotDashed className="size-5 text-amber-500" />;
  }
  return <CircleDashed className="size-5 text-muted-foreground/50" />;
}
