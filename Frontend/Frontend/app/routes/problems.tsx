import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Check, CircleDashed, CircleDotDashed, Search, Filter, X, Star,
  Shuffle,
} from "lucide-react";
import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import type { Category, ProblemSummary } from "~/lib/types";
import { PageHeader } from "~/components/common/PageHeader";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { Empty } from "~/components/common/Empty";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "~/components/ui/select";
import { formatNumber } from "~/lib/format";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "todo", label: "Todo" },
  { value: "attempted", label: "Attempted" },
  { value: "solved", label: "Solved" },
];
const DIFFICULTY_OPTIONS = [
  { value: "all", label: "All difficulties" },
  { value: "EASY", label: "Easy" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HARD", label: "Hard" },
];
const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "ALGORITHM", label: "Algorithm" },
  { value: "BACKEND", label: "Backend" },
  { value: "FRONTEND", label: "Frontend" },
  { value: "SQL", label: "SQL" },
];
const TYPE_PILL_CLASS: Record<string, string> = {
  ALGORITHM: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  BACKEND:   "bg-blue-500/10  text-blue-400  border-blue-500/20",
  FRONTEND:  "bg-purple-500/10 text-purple-400 border-purple-500/20",
  SQL:       "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
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

  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => { setSearchInput(search); }, [search]);

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
      .then(r => setItems(r.items))
      .finally(() => setLoading(false));
  }, [search, difficulty, category, status, type]);

  function setParam(k: string, v: string) {
    const p = new URLSearchParams(params);
    if (!v || v === "all") p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  }

  function clearFilters() {
    setParams(new URLSearchParams(), { replace: true });
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParam("search", searchInput.trim());
  }

  async function toggleFavorite(slug: string) {
    if (!user) return toast.error("Sign in to save favourites");
    setItems(list => list.map(p => p.slug === slug ? { ...p, favorited: !p.favorited } : p));
    try {
      await api(`/problems/${slug}/favorite`, { method: "POST" });
    } catch {
      toast.error("Could not update favourite");
      // revert
      setItems(list => list.map(p => p.slug === slug ? { ...p, favorited: !p.favorited } : p));
    }
  }

  function pickRandom() {
    if (items.length === 0) return;
    const p = items[Math.floor(Math.random() * items.length)];
    window.location.assign(`/problems/${p.slug}`);
  }

  const totals = useMemo(() => ({
    all: items.length,
    easy: items.filter(p => p.difficulty === "EASY").length,
    medium: items.filter(p => p.difficulty === "MEDIUM").length,
    hard: items.filter(p => p.difficulty === "HARD").length,
    solved: items.filter(p => p.status === "solved").length,
  }), [items]);

  const hasFilters = !!(search || difficulty !== "all" || category !== "all" || status !== "all" || type !== "all");

  return (
    <>
      <PageHeader
        title="Problems"
        description={`Browse the catalogue and pick your next challenge${user ? "" : " — sign in to track progress"}.`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={pickRandom} disabled={items.length === 0}>
              <Shuffle className="size-4 mr-1.5" /> Random
            </Button>
          </div>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Total" value={totals.all} />
        <Stat label="Easy" value={totals.easy} valueClass="text-emerald-500" />
        <Stat label="Medium" value={totals.medium} valueClass="text-amber-500" />
        <Stat label="Hard" value={totals.hard} valueClass="text-rose-500" />
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4 mb-5">
        <div className="flex flex-wrap gap-2 items-center">
          <form onSubmit={onSearchSubmit} className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title or tag…"
              className="pl-9 bg-input/50"
            />
          </form>
          <Select value={difficulty} onValueChange={(v) => setParam("difficulty", v)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DIFFICULTY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(v) => setParam("type", v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setParam("status", v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => setParam("category", v)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table / list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="hidden sm:grid grid-cols-12 gap-4 px-4 py-2.5 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div className="col-span-1">Status</div>
          <div className="col-span-5">Title</div>
          <div className="col-span-2">Difficulty</div>
          <div className="col-span-2">Acceptance</div>
          <div className="col-span-2 text-right">Submissions</div>
        </div>

        {loading ? (
          <div className="px-4 py-12 text-sm text-muted-foreground text-center">Loading problems…</div>
        ) : items.length === 0 ? (
          <Empty
            icon={Filter}
            title="No problems match your filters"
            description="Try clearing some filters or broadening the search."
            action={hasFilters ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : null}
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((p, i) => (
              <li key={p.id} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-accent/40 transition-colors">
                <div className="col-span-1 flex items-center">
                  {p.status === "solved" ? (
                    <span className="inline-flex items-center justify-center size-5 rounded-full bg-emerald-500 text-white">
                      <Check className="size-3" />
                    </span>
                  ) : p.status === "attempted" ? (
                    <CircleDotDashed className="size-5 text-amber-500" />
                  ) : (
                    <CircleDashed className="size-5 text-muted-foreground/50" />
                  )}
                </div>

                <div className="col-span-12 sm:col-span-5 -mt-1 sm:mt-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono w-8">#{String(i + 1).padStart(3, "0")}</span>
                    <Link to={`/problems/${p.slug}`} className="font-medium hover:text-primary">
                      {p.title}
                    </Link>
                    {p.problemType && p.problemType !== "ALGORITHM" && (
                      <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${TYPE_PILL_CLASS[p.problemType] || ""}`}>
                        {p.problemType}
                      </span>
                    )}
                    <button
                      onClick={() => toggleFavorite(p.slug)}
                      className={`p-1 rounded text-xs ${p.favorited ? "text-amber-500" : "text-muted-foreground hover:text-amber-500"}`}
                      title={p.favorited ? "Remove from favourites" : "Add to favourites"}
                      aria-label="Toggle favourite"
                    >
                      <Star className={`size-3.5 ${p.favorited ? "fill-current" : ""}`} />
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                    <DifficultyBadge difficulty={p.difficulty} />
                    {p.category && <span className="text-[11px] text-muted-foreground">{p.category.name}</span>}
                  </div>
                  <div className="mt-1 hidden sm:flex gap-1 flex-wrap">
                    {p.tags.slice(0, 4).map(t => (
                      <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                    ))}
                  </div>
                </div>

                <div className="col-span-3 sm:col-span-2 flex items-center"><DifficultyBadge difficulty={p.difficulty} /></div>
                <div className="col-span-3 sm:col-span-2 flex items-center text-sm text-muted-foreground tabular-nums">{p.acceptanceRate}%</div>
                <div className="col-span-6 sm:col-span-2 flex items-center justify-end text-sm text-muted-foreground tabular-nums">
                  {formatNumber(p.totalSubmissions)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, valueClass = "" }: { label: string; value: number; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
