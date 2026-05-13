/**
 * Instructor courses dashboard. Lists every course visible to the
 * actor — INSTRUCTOR / ADMIN see all of them per ADR 0008.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BookOpen, Plus, ArrowRight, Users } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { RoleGuard } from "~/lib/guards";
import { useAuth } from "~/lib/auth";
import { PageHeader } from "~/components/common/PageHeader";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "~/components/ui/dialog";
import type { CourseSummary } from "~/lib/teaching-types";
import { isAdmin } from "~/lib/types";

export default function TeachCoursesPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const { user } = useAuth();
  const [items, setItems] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      setItems(await api<CourseSummary[]>("/courses"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load courses");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  return (
    <>
      <PageHeader
        title="Courses"
        description="Each course holds a problem syllabus, student groups, and exams. Only the course owner (or an ADMIN) can edit a given course."
        action={
          <Button onClick={() => setCreateOpen(true)} className="gradient-bg text-white border-0">
            <Plus className="size-4 mr-1.5" /> New course
          </Button>
        }
      />

      {loading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : items.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="No courses yet"
          description="Create your first course to attach problems and assign students to it."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4 mr-1.5" />New course</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map(c => (
            <Link
              key={c.slug}
              to={`/teach/courses/${c.slug}`}
              className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold truncate">{c.title}</h3>
                  <code className="text-xs text-muted-foreground">{c.slug}</code>
                </div>
                <ArrowRight className="size-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" />
                  Owner: {c.owner.username}
                  {user?.id === c.owner.id && <span className="text-primary">(you)</span>}
                  {isAdmin(user) && user?.id !== c.owner.id && <span className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px]">admin override</span>}
                </span>
                <span>·</span>
                <span>{c.problemCount} problem{c.problemCount === 1 ? "" : "s"}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateCourseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={reload}
      />
    </>
  );
}

function CreateCourseDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api("/courses", {
        method: "POST",
        body: { slug: slug.trim(), title: title.trim(), description: description.trim() || undefined },
      });
      toast.success(`Created "${title}"`);
      setSlug(""); setTitle(""); setDescription("");
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create course");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create a new course</DialogTitle>
            <DialogDescription>
              You will become the course owner and can attach problems and add groups afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-4">
            <div>
              <Label htmlFor="course-slug">Slug</Label>
              <Input
                id="course-slug"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="cs-201-databases"
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="course-title">Title</Label>
              <Input
                id="course-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="CS-201 — Databases"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="course-desc">Description (optional)</Label>
              <Textarea
                id="course-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this course covers, term, language of instruction…"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting} className="gradient-bg text-white border-0">
              {submitting ? "Creating…" : "Create course"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
