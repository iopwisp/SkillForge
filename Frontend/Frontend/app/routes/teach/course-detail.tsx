/**
 * Course detail page for instructors / admins.
 *
 * The page itself owns the course header (title, description, owner info,
 * delete-course flow) and routes the user through 4 tabs that each map
 * to a single backend area:
 *   - Syllabus  → /api/courses/:slug              (problems list)
 *   - Groups    → /api/courses/:slug/groups
 *   - Exams     → /api/courses/:slug/exams
 *   - Gradebook → /api/courses/:slug/gradebook(.csv)
 *
 * Tab state is persisted in `?tab=...` so refreshing or sharing a URL
 * lands the recipient on the same panel.
 */
import { useEffect, useState } from "react";
import {
  Link, useNavigate, useParams, useSearchParams,
} from "react-router";
import {
  Activity, ArrowLeft, BookOpen, FileSignature, Pencil, Trash2, Trophy, Users,
  AlertCircle, Save, Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { Loading, RoleGuard } from "~/lib/guards";
import { useAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "~/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty } from "~/components/common/Empty";
import { SyllabusPanel } from "~/components/teach/SyllabusPanel";
import { GroupsPanel } from "~/components/teach/GroupsPanel";
import { ExamsPanel } from "~/components/teach/ExamsPanel";
import { GradebookPanel } from "~/components/teach/GradebookPanel";
import type { CourseDetail, GroupSummary } from "~/lib/teaching-types";

const VALID_TABS = ["syllabus", "groups", "exams", "gradebook"] as const;
type Tab = (typeof VALID_TABS)[number];

export default function CourseDetailPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab;
  const initialTab: Tab = VALID_TABS.includes(tabParam) ? tabParam : "syllabus";

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [checkingInvite, setCheckingInvite] = useState(false);

  async function reload() {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      setCourse(await api<CourseDetail>(`/courses/${slug}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load course");
      setCourse(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [slug]);

  function setTab(t: Tab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    setSearchParams(next, { replace: true });
  }

  async function deleteCourse() {
    if (!slug) return;
    setPendingDelete(false);
    try {
      await api(`/courses/${slug}`, { method: "DELETE" });
      toast.success(`Deleted course "${slug}"`);
      navigate("/teach/courses", { replace: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete course");
    }
  }

  // Invite codes live on groups, not courses. From the instructor's
  // perspective, though, "generate invite code" is a course-level verb —
  // so we probe the groups list and either jump into the Groups tab
  // focused on the first group's invite section, or prompt to create a
  // default group before showing the invite UI.
  async function openInviteFlow() {
    if (!slug) return;
    setCheckingInvite(true);
    try {
      const groups = await api<GroupSummary[]>(`/courses/${slug}/groups`);
      if (groups.length > 0) {
        const next = new URLSearchParams(searchParams);
        next.set("tab", "groups");
        next.set("focus", "invite");
        setSearchParams(next, { replace: true });
      } else {
        setCreateGroupOpen(true);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not check groups");
    } finally {
      setCheckingInvite(false);
    }
  }

  if (loading) return <Loading />;
  if (error || !course) {
    return (
      <Empty
        icon={AlertCircle}
        title="Could not load this course"
        description={error ?? "It may not exist or you may not have access."}
        action={<Button asChild><Link to="/teach/courses"><ArrowLeft className="size-4 mr-1.5" />Back to courses</Link></Button>}
      />
    );
  }

  const isOwner = !!user && (course.owner.id === user.id || isAdmin(user));

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
            <Link to="/teach/courses"><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight truncate">{course.title}</h1>
            <div className="mt-1 flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
              <code className="text-xs">{course.slug}</code>
              <span>·</span>
              <span>Owner: <strong className="text-foreground">@{course.owner.username}</strong></span>
              <span>·</span>
              <span>{course.problems.length} problem{course.problems.length === 1 ? "" : "s"}</span>
            </div>
            {course.description && (
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl whitespace-pre-line">
                {course.description}
              </p>
            )}
          </div>
        </div>
        {isOwner && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/teach/courses/${slug}/live`}>
                <Activity className="size-4 mr-1.5" /> Live
              </Link>
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={openInviteFlow}
              disabled={checkingInvite}
            >
              <Ticket className="size-4 mr-1.5" /> Invite code
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4 mr-1.5" /> Edit
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => setPendingDelete(true)}
              className="text-rose-500 hover:text-rose-500"
            >
              <Trash2 className="size-4 mr-1.5" /> Delete
            </Button>
          </div>
        )}
      </div>

      <Tabs value={initialTab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-5">
          <TabsTrigger value="syllabus"><BookOpen className="size-4 mr-1.5" />Syllabus</TabsTrigger>
          <TabsTrigger value="groups"><Users className="size-4 mr-1.5" />Groups</TabsTrigger>
          <TabsTrigger value="exams"><FileSignature className="size-4 mr-1.5" />Exams</TabsTrigger>
          <TabsTrigger value="gradebook"><Trophy className="size-4 mr-1.5" />Gradebook</TabsTrigger>
        </TabsList>

        <TabsContent value="syllabus">
          <SyllabusPanel
            courseSlug={course.slug}
            problems={course.problems}
            onChanged={reload}
          />
        </TabsContent>
        <TabsContent value="groups">
          <GroupsPanel courseSlug={course.slug} />
        </TabsContent>
        <TabsContent value="exams">
          <ExamsPanel courseSlug={course.slug} />
        </TabsContent>
        <TabsContent value="gradebook">
          <GradebookPanel courseSlug={course.slug} />
        </TabsContent>
      </Tabs>

      <EditCourseDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        course={course}
        onSaved={reload}
      />

      <CreateDefaultGroupDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        courseSlug={course.slug}
        onCreated={() => {
          setCreateGroupOpen(false);
          const next = new URLSearchParams(searchParams);
          next.set("tab", "groups");
          next.set("focus", "invite");
          setSearchParams(next, { replace: true });
        }}
      />

      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this course?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{course.title}</strong> will be permanently removed. All groups,
              exams, and the syllabus are deleted with it.
              Submissions made by students stay in the database; only their links
              to this course are dropped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteCourse}
              className="bg-rose-500 hover:bg-rose-500/90 text-white"
            >Delete course</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditCourseDialog({
  open, onOpenChange, course, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  course: CourseDetail;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(course.title);
      setDescription(course.description ?? "");
    }
  }, [open, course]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: any = {};
      if (title.trim() !== course.title) body.title = title.trim();
      if ((description ?? "") !== (course.description ?? "")) body.description = description;
      if (Object.keys(body).length === 0) {
        onOpenChange(false);
        setSubmitting(false);
        return;
      }
      await api(`/courses/${course.slug}`, { method: "PUT", body });
      toast.success("Saved changes");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form onSubmit={submit}>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit course</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-3 my-3">
            <div>
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={submitting}>
              <Save className="size-4 mr-1.5" />
              {submitting ? "Saving…" : "Save"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Entry-point dialog for the "Invite code" header button when the
 * course has no groups yet. Students can only join a specific group,
 * so the invite code lives on the group — we offer to create a sane
 * default (`main` / `Main`) so the instructor can keep moving instead
 * of context-switching into the Groups tab to bootstrap one.
 */
function CreateDefaultGroupDialog({
  open, onOpenChange, courseSlug, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseSlug: string;
  onCreated: () => void;
}) {
  const [slug, setSlug] = useState("main");
  const [title, setTitle] = useState("Main");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSlug("main");
      setTitle("Main");
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api(`/courses/${courseSlug}/groups`, {
        method: "POST",
        body: { slug: slug.trim(), title: title.trim() },
      });
      toast.success(`Created group "${title}"`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create group");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create a group first</DialogTitle>
            <DialogDescription>
              Invite codes live on groups — students join a specific group.
              Create a default one here and we'll take you to the invite section.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 my-3">
            <div>
              <Label htmlFor="default-group-slug">Slug</Label>
              <Input
                id="default-group-slug"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="main"
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="default-group-title">Title</Label>
              <Input
                id="default-group-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Main"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
