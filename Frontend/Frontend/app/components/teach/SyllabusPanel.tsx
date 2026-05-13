/**
 * Syllabus panel — list of problems attached to a course.
 *
 * The course's `problems` field comes pre-loaded by the parent (the
 * `GET /api/courses/:slug` endpoint already returns the syllabus). We
 * locally re-fetch after attach/detach so the position field stays in
 * sync without a full page reload.
 */
import { useState } from "react";
import { Link } from "react-router";
import { Plus, Trash2, BookOpen, ListChecks } from "lucide-react";
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
  open, onOpenChange, courseSlug, onAttached,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseSlug: string;
  onAttached: () => void;
}) {
  const [problemSlug, setProblemSlug] = useState("");
  const [position, setPosition] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: any = { problemSlug: problemSlug.trim() };
      if (position.trim()) body.position = parseInt(position, 10);
      await api(`/courses/${courseSlug}/problems`, { method: "POST", body });
      toast.success(`Attached "${problemSlug}"`);
      setProblemSlug(""); setPosition("");
      onOpenChange(false);
      onAttached();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not attach problem");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Attach problem to course</DialogTitle>
          </DialogHeader>
          <p className="my-2 text-sm text-muted-foreground inline-flex items-center gap-1.5">
            <ListChecks className="size-4" />
            Use the slug from the <Link to="/teach/problems" className="text-primary hover:underline">problems catalog</Link>.
          </p>
          <div className="space-y-3 my-3">
            <div>
              <Label htmlFor="problem-slug">Problem slug</Label>
              <Input
                id="problem-slug"
                required
                value={problemSlug}
                onChange={(e) => setProblemSlug(e.target.value.toLowerCase())}
                placeholder="palindrome-check"
                className="mt-1.5 font-mono"
              />
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
            <Button type="submit" disabled={submitting}>
              {submitting ? "Attaching…" : "Attach"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
