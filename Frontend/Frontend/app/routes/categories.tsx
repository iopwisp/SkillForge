import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Layers, Type, ArrowRightLeft, Move, Search, Layers3, Link as LinkIcon, GitBranch,
  Network, Cpu, TrendingUp, Database, Folder,
  type LucideIcon,
} from "lucide-react";
import { api } from "~/lib/api";
import type { Category } from "~/lib/types";
import { PageHeader } from "~/components/common/PageHeader";

const ICON_MAP: Record<string, LucideIcon> = {
  Layers, Type, ArrowRightLeft, Move, Search, Layers3, Link: LinkIcon,
  GitBranch, Network, Cpu, TrendingUp, Database, Folder,
};

const TILE_TONES: Record<string, string> = {
  indigo: "from-indigo-500/30 to-indigo-500/0 text-indigo-500",
  amber:  "from-amber-500/30 to-amber-500/0 text-amber-500",
  sky:    "from-sky-500/30 to-sky-500/0 text-sky-500",
  emerald:"from-emerald-500/30 to-emerald-500/0 text-emerald-500",
  violet: "from-violet-500/30 to-violet-500/0 text-violet-500",
  rose:   "from-rose-500/30 to-rose-500/0 text-rose-500",
  orange: "from-orange-500/30 to-orange-500/0 text-orange-500",
  teal:   "from-teal-500/30 to-teal-500/0 text-teal-500",
  pink:   "from-pink-500/30 to-pink-500/0 text-pink-500",
  fuchsia:"from-fuchsia-500/30 to-fuchsia-500/0 text-fuchsia-500",
  lime:   "from-lime-500/30 to-lime-500/0 text-lime-500",
  cyan:   "from-cyan-500/30 to-cyan-500/0 text-cyan-500",
};

export default function CategoriesPage() {
  const [list, setList] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Category[]>("/categories").then(setList).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Practice by topic — each category is a curated set of problems built around a single technique."
      />

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(c => {
            const Icon = ICON_MAP[c.icon || "Folder"] || Folder;
            const toneKey = c.color || "indigo";
            return (
              <Link
                key={c.id}
                to={`/problems?category=${c.slug}`}
                className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-colors"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${TILE_TONES[toneKey] || TILE_TONES.indigo} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
                <div className={`relative size-10 rounded-lg flex items-center justify-center bg-gradient-to-br ${TILE_TONES[toneKey] || TILE_TONES.indigo} ${(TILE_TONES[toneKey] || TILE_TONES.indigo).split(" ").pop()}`}>
                  <Icon className="size-5" />
                </div>
                <h2 className="relative mt-4 font-semibold">{c.name}</h2>
                <p className="relative mt-1 text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                <div className="relative mt-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.problem_count}</span> problems →
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
