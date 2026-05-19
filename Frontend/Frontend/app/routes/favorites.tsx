import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Star } from "lucide-react";
import { api } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import type { ProblemSummary } from "~/lib/types";

export default function FavoritesPage() {
  return <ProtectedRoute><Inner /></ProtectedRoute>;
}

function Inner() {
  const [items, setItems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<ProblemSummary[]>("/users/me/favorites").then(setItems).finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader title="Favourites" description="Problems you’ve starred for later." />
      {items.length === 0 ? (
        <Empty
          icon={Star}
          title="No favourites yet"
          description="Click the star icon on any problem to save it here."
          action={<Button asChild><Link to="/problems">Browse problems</Link></Button>}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(p => (
            <Link key={p.id} to={`/problems/${p.slug}`}
              className="group flex flex-col card-interactive p-5"
            >
              <div className="flex items-center justify-between">
                <DifficultyBadge difficulty={p.difficulty} />
                <Star className="size-4 text-amber-500 fill-current" />
              </div>
              <h3 className="mt-3 font-semibold group-hover:text-primary">{p.title}</h3>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.tags.slice(0, 3).map(t => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                ))}
              </div>
              {p.category && (
                <p className="mt-auto pt-4 text-xs text-muted-foreground">{p.category.name}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
