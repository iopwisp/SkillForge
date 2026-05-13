/**
 * Instructor-facing problems catalog.
 *
 * Lists every problem in the installation (per ADR 0011, the catalog is
 * shared — no per-problem owner column yet) with quick edit / delete
 * actions. Mutations 403/409 from the backend bubble up as toasts.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Pencil, Plus, Trash2, Search, FileQuestion } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { RoleGuard } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { Empty } from "~/components/common/Empty";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { ProblemSummary, ProblemType } from "~/lib/types";

const TYPES: Array<{ value: string; label: string }> = [
  { value: "all",      label: "All types" },
  { value: "ALGORITHM", label: "Algorithm" },
  { value: "SQL",       label: "SQL" },
  { value: "BACKEND",   label: "Backend" },
  { value: "FRONTEND",  label: "Frontend" },
];

interface ProblemListResponse {
  items: ProblemSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export default function TeachProblemsPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const [items, setItems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [pendingDelete, setPendingDelete] = useState<ProblemSummary | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "200" });
      if (type !== "all") params.set("type", type);
      const data = await api<ProblemListResponse>(`/problems?${params}`);
      setItems(data.items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load problems");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q)),
    );
  }, [items, search]);

  async function doDelete(p: ProblemSummary) {
    setPendingDelete(null);
    try {
      await api(`/problems/${p.slug}`, { method: "DELETE" });
      toast.success(`Deleted "${p.title}"`);
      setItems(prev => prev.filter(x => x.slug !== p.slug));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete");
    }
  }

  return (
    <>
      <PageHeader
        title="Problems"
        description="The shared catalog of problems on this installation. Any instructor or admin can edit or remove problems that are not yet referenced by courses, exams, or submissions."
        action={
          <Button asChild className="gradient-bg text-white border-0">
            <Link to="/teach/problems/new"><Plus className="size-4 mr-1.5" /> New problem</Link>
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, slug or tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : filtered.length === 0 ? (
        <Empty
          icon={FileQuestion}
          title={items.length === 0 ? "No problems yet" : "No problems match your filter"}
          description={items.length === 0
            ? "Create the first problem to start building your catalog."
            : "Try clearing the search or changing the type filter."}
          action={items.length === 0 && (
            <Button asChild><Link to="/teach/problems/new"><Plus className="size-4 mr-1.5" />Create problem</Link></Button>
          )}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="col-span-5">Title</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-1">Diff.</div>
            <div className="col-span-2">Tags</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          <ul className="divide-y divide-border">
            {filtered.map(p => (
              <li key={p.slug} className="grid grid-cols-12 gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                <div className="col-span-12 sm:col-span-5">
                  <Link to={`/problems/${p.slug}`} className="font-medium hover:text-primary truncate block">
                    {p.title}
                  </Link>
                  <code className="text-xs text-muted-foreground">{p.slug}</code>
                </div>
                <div className="col-span-6 sm:col-span-2 text-xs flex items-center text-muted-foreground">
                  <TypePill type={p.problemType ?? "ALGORITHM"} />
                </div>
                <div className="col-span-3 sm:col-span-1 flex items-center">
                  <DifficultyBadge difficulty={p.difficulty} />
                </div>
                <div className="col-span-12 sm:col-span-2 flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                  {(p.tags || []).slice(0, 3).map(t => (
                    <span key={t} className="px-1.5 py-0.5 rounded bg-muted">{t}</span>
                  ))}
                </div>
                <div className="col-span-12 sm:col-span-2 flex items-center justify-start sm:justify-end gap-1">
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/teach/problems/${p.slug}/edit`}>
                      <Pencil className="size-3.5 mr-1.5" /> Edit
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(p)}
                    className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this problem?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  This will permanently remove <strong>{pendingDelete.title}</strong>.
                  The backend will refuse the delete if the problem is still
                  referenced by any course, exam, or submission.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && doDelete(pendingDelete)}
              className="bg-rose-500 hover:bg-rose-500/90 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TypePill({ type }: { type: ProblemType }) {
  const tones: Record<ProblemType, string> = {
    ALGORITHM: "bg-violet-500/10 text-violet-500",
    SQL:       "bg-amber-500/10 text-amber-500",
    BACKEND:   "bg-emerald-500/10 text-emerald-500",
    FRONTEND:  "bg-sky-500/10 text-sky-500",
    STDIO:     "bg-rose-500/10 text-rose-500",
  };
  return <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${tones[type]}`}>{type}</span>;
}
