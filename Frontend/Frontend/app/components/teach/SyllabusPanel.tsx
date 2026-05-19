/**
 * Syllabus panel — list of problems attached to a course.
 *
 * The course's `problems` field comes pre-loaded by the parent (the
 * `GET /api/courses/:slug` endpoint already returns the syllabus). We
 * locally re-fetch after attach/detach so the position field stays in
 * sync without a full page reload.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Plus, Trash2, BookOpen, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Empty } from "~/components/common/Empty";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "~/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { CourseProblemRef } from "~/lib/teaching-types";
import type { ProblemSummary } from "~/lib/types";

export function SyllabusPanel({
  courseSlug,
  problems,
  onChanged,
}: {
  courseSlug: string;
  problems: CourseProblemRef[];
  onChanged: () => void;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingDetach, setPendingDetach] = useState<CourseProblemRef | null>(null);

  async function detach(p: CourseProblemRef) {
    setPendingDetach(null);
    try {
      await api(`/courses/${courseSlug}/problems/${p.slug}`, { method: "DELETE" });
      toast.success(`Removed "${p.title}"`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not remove the problem");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Problems shown to enrolled students as the course syllabus.
        </p>
        <Button onClick={() => setAttachOpen(true)} size="sm">
          <Plus className="size-4 mr-1.5" /> Attach problem
        </Button>
      </div>

      {problems.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="No problems in this course yet"
          description="Attach problems from the catalog to build the syllabus."
          action={<Button onClick={() => setAttachOpen(true)}><Plus className="size-4 mr-1.5" />Attach the first problem</Button>}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border">
            {[...problems].sort((a, b) => a.position - b.position).map(p => (
              <li key={p.slug} className="grid grid-cols-12 gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                <div className="col-span-1 flex items-center text-xs text-muted-foreground tabular-nums">
                  #{p.position}
                </div>
                <div className="col-span-12 sm:col-span-7">
                  <Link to={`/problems/${p.slug}`} className="font-medium hover:text-primary truncate block">
                    {p.title}
                  </Link>
                  <code className="text-xs text-muted-foreground">{p.slug}</code>
                </div>
                <div className="col-span-6 sm:col-span-2 flex items-center">
                  <DifficultyBadge difficulty={p.difficulty} />
                  <span className="ml-2 text-[11px] text-muted-foreground">{p.problemType}</span>
                </div>
                <div className="col-span-6 sm:col-span-2 flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDetach(p)}
                    className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AttachProblemDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        courseSlug={courseSlug}
        attachedSlugs={problems.map(p => p.slug)}
        onAttached={onChanged}
      />

      <AlertDialog open={!!pendingDetach} onOpenChange={(o) => !o && setPendingDetach(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from syllabus?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDetach && (
                <>The problem itself stays in the catalog; only this course-link is removed.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDetach && detach(pendingDetach)}
              className="bg-rose-500 hover:bg-rose-500/90 text-white"
            >Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AttachProblemDialog({
  open, onOpenChange, courseSlug, attachedSlugs, onAttached,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseSlug: string;
  attachedSlugs: string[];
  onAttached: () => void;
}) {
  const [catalog, setCatalog] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProblemSummary[]>([]);
  const [position, setPosition] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch problems catalog on open. Reset local state.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected([]);
    setPosition("");
    setLoading(true);
    api<{ items: ProblemSummary[]; total: number; page: number; pageSize: number }>(
      "/problems?pageSize=200",
    )
      .then((r) => setCatalog(r.items || []))
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not load problems"))
      .finally(() => setLoading(false));
  }, [open]);

  const attachedSet = useMemo(() => new Set(attachedSlugs), [attachedSlugs]);

  const filtered = useMemo(() => {
    const available = catalog.filter(p => !attachedSet.has(p.slug));
    const q = query.trim().toLowerCase();
    if (!q) return available.slice(0, 50);
    return available.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q)),
    ).slice(0, 50);
  }, [catalog, attachedSet, query]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return;
    setSubmitting(true);
    try {
      let basePos = position.trim() ? parseInt(position, 10) : undefined;
      for (let i = 0; i < selected.length; i++) {
        const body: any = { problemSlug: selected[i].slug };
        if (basePos !== undefined) body.position = basePos + i;
        await api(`/courses/${courseSlug}/problems`, { method: "POST", body });
      }
      toast.success(`Attached ${selected.length} problem${selected.length === 1 ? "" : "s"}`);
      onOpenChange(false);
      onAttached();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not attach problems");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="flex flex-col min-w-0 w-full">
          <DialogHeader>
            <DialogTitle>Attach problem to course</DialogTitle>
          </DialogHeader>
          <p className="my-2 text-sm text-muted-foreground">
            Search the catalog and pick a problem to add to the syllabus.{" "}
            <Link to="/teach/problems" className="text-primary hover:underline">
              Manage the catalog →
            </Link>
          </p>

          <div className="space-y-4 my-4">
            <div>
              <Label htmlFor="problem-search" className="sr-only">Problem Search</Label>
              <div className="mt-1.5 rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
                <div className="relative border-b border-border/60">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <input
                    id="problem-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by title, slug, or tag…"
                    className="w-full min-w-0 bg-transparent pl-10 pr-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
                    autoComplete="off"
                  />
                </div>

                <div className="max-h-64 overflow-y-auto p-1.5">
                  {loading ? (
                    <div className="p-4 text-sm text-center text-muted-foreground">Loading catalog…</div>
                  ) : filtered.length === 0 ? (
                    <div className="p-4 text-sm text-center text-muted-foreground">
                      {catalog.length === 0
                        ? "No problems in the catalog. Create one in the problems catalog first."
                        : attachedSet.size > 0 && catalog.every(p => attachedSet.has(p.slug))
                          ? "Every problem in the catalog is already attached."
                          : "No problems match this search."}
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {filtered.map(p => {
                        const isSelected = selected.some(x => x.slug === p.slug);
                        return (
                          <li key={p.slug}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelected(current => {
                                  if (current.some(x => x.slug === p.slug)) {
                                    return current.filter(x => x.slug !== p.slug);
                                  }
                                  return [...current, p];
                                });
                              }}
                              className={`w-full text-left px-3 py-2.5 rounded-md flex items-center gap-3 transition-colors ${
                                isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent/50 text-foreground"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate text-sm">{p.title}</div>
                                <code className="text-xs opacity-70 block truncate mt-0.5">{p.slug}</code>
                              </div>
                              <DifficultyBadge difficulty={p.difficulty} className={isSelected ? "bg-background" : ""} />
                              {p.problemType && (
                                <span className={`text-[10px] uppercase tracking-wider shrink-0 ${isSelected ? "text-primary/70" : "text-muted-foreground"}`}>
                                  {p.problemType}
                                </span>
                              )}
                              <div className="w-5 flex justify-end shrink-0">
                                {isSelected && <Check className="size-4" />}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="position">Position (optional)</Label>
              <Input
                id="position"
                type="number"
                min={0}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="leave blank for end of list"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || selected.length === 0}>
              {submitting ? "Attaching…" : selected.length > 0 ? `Attach ${selected.length} problem${selected.length === 1 ? "" : "s"}` : "Attach"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
