/**
 * Exams panel — manage timed assessments for a course.
 *
 * Per ADR 0009 the backend freezes mutations to an exam once
 * `starts_at` is in the past (PUT / attach / detach all 4xx). Delete is
 * always allowed. The UI mirrors that by disabling those buttons with
 * a tooltip rather than letting the user click and hit a 4xx.
 *
 * Datetime fields use the shared `<DateTimePicker>` which emits ISO
 * strings directly — backend's `z.string().datetime({ offset: true })`
 * accepts them as-is.
 */
import { useEffect, useState } from "react";
import {
  Plus, Trash2, FileSignature, Calendar, Clock, AlertCircle,
  Pencil, ListPlus,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Empty } from "~/components/common/Empty";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "~/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type {
  ExamSummary, ExamDetail, GroupSummary,
} from "~/lib/teaching-types";
import { formatDateTime } from "~/lib/format";
import { DateTimePicker } from "~/components/common/DateTimePicker";
import { addDays, addMinutes, tomorrow9am } from "~/lib/datetime";

const NO_GROUP = "__none__";

export function ExamsPanel({ courseSlug }: { courseSlug: string }) {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExamSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ExamSummary | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [examList, groupList] = await Promise.all([
        api<ExamSummary[]>(`/courses/${courseSlug}/exams`),
        api<GroupSummary[]>(`/courses/${courseSlug}/groups`),
      ]);
      setExams(examList);
      setGroups(groupList);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load exams");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [courseSlug]);

  async function deleteExam(exam: ExamSummary) {
    setPendingDelete(null);
    try {
      await api(`/courses/${courseSlug}/exams/${exam.slug}`, { method: "DELETE" });
      toast.success(`Deleted "${exam.title}"`);
      if (expanded === exam.slug) setExpanded(null);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete exam");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Timed assessments. Per-student deadline = min(<code>started_at + duration</code>, <code>endsAt</code>).
        </p>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="size-4 mr-1.5" /> New exam
        </Button>
      </div>

      {loading ? (
        <div className="h-72 rounded-xl border border-border bg-card animate-pulse" />
      ) : exams.length === 0 ? (
        <Empty
          icon={FileSignature}
          title="No exams yet"
          description="Create an exam to assess your students on a subset of the syllabus."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4 mr-1.5" />Create exam</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {exams.map(exam => {
            const isStarted = new Date(exam.startsAt).getTime() <= Date.now();
            const isExpanded = expanded === exam.slug;
            return (
              <li key={exam.slug} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{exam.title}</h3>
                      <code className="text-xs text-muted-foreground">{exam.slug}</code>
                      {exam.groupSlug ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500">
                          group · {exam.groupSlug}
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">
                          course-wide
                        </span>
                      )}
                      {isStarted && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500">
                          frozen (started)
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3.5" />
                        {formatDateTime(exam.startsAt)} → {formatDateTime(exam.endsAt)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" />
                        {exam.durationMinutes} min
                      </span>
                      <span>{exam.problemCount} problem{exam.problemCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpanded(isExpanded ? null : exam.slug)}
                    >
                      {isExpanded ? "Hide" : "Manage"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditTarget(exam)}
                      disabled={isStarted}
                      title={isStarted ? "Cannot edit after the exam window has started" : "Edit"}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(exam)}
                      className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-border">
                    <ExamProblemsPanel
                      courseSlug={courseSlug}
                      examSlug={exam.slug}
                      frozen={isStarted}
                      onChanged={reload}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ExamFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        courseSlug={courseSlug}
        groups={groups}
        onSaved={reload}
      />

      <ExamFormDialog
        mode="edit"
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        courseSlug={courseSlug}
        groups={groups}
        initial={editTarget}
        onSaved={reload}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this exam?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  <strong>{pendingDelete.title}</strong> and all its problem links will be removed.
                  Submissions made during this exam are kept; their <code>exam_attempt_id</code> column is set to NULL.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && deleteExam(pendingDelete)}
              className="bg-rose-500 hover:bg-rose-500/90 text-white"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Exam problems sub-panel ───────────────────────────────────────────── */

function ExamProblemsPanel({
  courseSlug, examSlug, frozen, onChanged,
}: {
  courseSlug: string;
  examSlug: string;
  frozen: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [problemSlug, setProblemSlug] = useState("");
  const [points, setPoints] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api<ExamDetail>(`/courses/${courseSlug}/exams/${examSlug}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load exam");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [courseSlug, examSlug]);

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: any = { problemSlug: problemSlug.trim() };
      if (points.trim()) body.points = parseInt(points, 10);
      await api(`/courses/${courseSlug}/exams/${examSlug}/problems`, { method: "POST", body });
      toast.success(`Attached "${problemSlug}"`);
      setProblemSlug(""); setPoints("1");
      reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not attach problem");
    } finally {
      setSubmitting(false);
    }
  }

  async function detach(slug: string) {
    try {
      await api(`/courses/${courseSlug}/exams/${examSlug}/problems/${slug}`, { method: "DELETE" });
      toast.success(`Removed "${slug}"`);
      reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not detach problem");
    }
  }

  if (loading) return <div className="mt-4 h-32 rounded-md bg-muted/40 animate-pulse" />;
  if (error || !detail) return (
    <div className="mt-4 inline-flex items-center gap-2 text-sm text-rose-500">
      <AlertCircle className="size-4" /> {error}
    </div>
  );

  return (
    <div className="mt-4 space-y-4">
      {detail.description && (
        <p className="text-sm text-muted-foreground whitespace-pre-line">{detail.description}</p>
      )}

      <div className="text-xs text-muted-foreground">
        Total: <strong className="text-foreground">{detail.totalPoints}</strong> pts
      </div>

      {detail.problems.length === 0 ? (
        <div className="text-sm text-muted-foreground">No problems attached yet.</div>
      ) : (
        <ul className="rounded-md border border-border divide-y divide-border">
          {detail.problems.map(p => (
            <li key={p.slug} className="px-4 py-2.5 flex items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">#{p.position}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.title}</div>
                <code className="text-xs text-muted-foreground">{p.slug}</code>
              </div>
              <DifficultyBadge difficulty={p.difficulty} />
              <span className="text-xs tabular-nums">{p.points} pts</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={frozen}
                title={frozen ? "Cannot detach after exam started" : "Detach"}
                onClick={() => detach(p.slug)}
                className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={attach} className="flex flex-col sm:flex-row gap-2 items-end">
        <div className="flex-1">
          <Label htmlFor={`exam-${examSlug}-attach`} className="sr-only">Problem slug</Label>
          <Input
            id={`exam-${examSlug}-attach`}
            value={problemSlug}
            onChange={(e) => setProblemSlug(e.target.value.toLowerCase())}
            placeholder="problem-slug"
            disabled={frozen}
            className="font-mono"
          />
        </div>
        <div className="w-28">
          <Label htmlFor={`exam-${examSlug}-points`} className="sr-only">Points</Label>
          <Input
            id={`exam-${examSlug}-points`}
            type="number"
            min={1}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="points"
            disabled={frozen}
          />
        </div>
        <Button type="submit" disabled={submitting || frozen || !problemSlug.trim()}>
          <ListPlus className="size-4 mr-1.5" />
          {submitting ? "Attaching…" : "Attach"}
        </Button>
      </form>
    </div>
  );
}

/* ─── Create/edit dialog ────────────────────────────────────────────────── */

interface ExamFormDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseSlug: string;
  groups: GroupSummary[];
  initial?: ExamSummary | null;
  onSaved: () => void;
}

function ExamFormDialog({
  mode, open, onOpenChange, courseSlug, groups, initial, onSaved,
}: ExamFormDialogProps) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // ISO strings (DateTimePicker emits ISO directly).
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [duration, setDuration] = useState(60);
  const [groupSlug, setGroupSlug] = useState<string>(NO_GROUP);
  const [submitting, setSubmitting] = useState(false);

  // (Re)hydrate the form whenever we open it.
  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setSlug(""); setTitle(""); setDescription("");
      setStartsAt(null); setEndsAt(null);
      setDuration(60);
      setGroupSlug(NO_GROUP);
    } else if (initial) {
      setSlug(initial.slug);
      setTitle(initial.title);
      setDescription("");          // GET on the list doesn't include description
      setStartsAt(initial.startsAt);
      setEndsAt(initial.endsAt);
      setDuration(initial.durationMinutes);
      setGroupSlug(initial.groupSlug ?? NO_GROUP);
    }
  }, [open, mode, initial]);

  // For "edit", we lazy-fetch description so it doesn't get clobbered to "" on save.
  useEffect(() => {
    if (mode !== "edit" || !open || !initial) return;
    api<ExamDetail>(`/courses/${courseSlug}/exams/${initial.slug}`)
      .then((d) => setDescription(d.description ?? ""))
      .catch(() => {});
  }, [mode, open, initial, courseSlug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (!startsAt || !endsAt) {
        toast.error("Выберите даты начала и окончания");
        setSubmitting(false);
        return;
      }
      if (!(new Date(endsAt) > new Date(startsAt))) {
        toast.error("End time must be after start time");
        setSubmitting(false);
        return;
      }
      const body: any = {
        title: title.trim(),
        startsAt,
        endsAt,
        durationMinutes: duration,
        groupSlug: groupSlug === NO_GROUP ? null : groupSlug,
        description: description.trim() || undefined,
      };
      if (mode === "create") {
        body.slug = slug.trim();
        await api(`/courses/${courseSlug}/exams`, { method: "POST", body });
        toast.success(`Created "${title}"`);
      } else if (initial) {
        await api(`/courses/${courseSlug}/exams/${initial.slug}`, { method: "PUT", body });
        toast.success("Saved changes");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save exam");
    } finally {
      setSubmitting(false);
    }
  }

  const startPresets = [
    { label: "Через 1 час",  getValue: () => addMinutes(new Date(), 60) },
    { label: "Через 3 часа", getValue: () => addMinutes(new Date(), 180) },
    { label: "Завтра 09:00", getValue: () => tomorrow9am() },
    { label: "Через неделю", getValue: () => addDays(new Date(), 7) },
  ];

  const endPresets = startsAt
    ? [
      { label: "+1 час",  getValue: () => addMinutes(new Date(startsAt), 60) },
      { label: "+2 часа", getValue: () => addMinutes(new Date(startsAt), 120) },
      { label: "+3 часа", getValue: () => addMinutes(new Date(startsAt), 180) },
    ]
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "New exam" : "Edit exam"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 my-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exam-slug">Slug</Label>
                <Input
                  id="exam-slug"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  disabled={mode === "edit"}
                  className="mt-1.5 font-mono"
                  placeholder="midterm-1"
                />
              </div>
              <div>
                <Label htmlFor="exam-group">Group (optional)</Label>
                <Select value={groupSlug} onValueChange={setGroupSlug}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_GROUP}>Course-wide (all enrolled students)</SelectItem>
                    {groups.map(g => (
                      <SelectItem key={g.slug} value={g.slug}>{g.title} ({g.slug})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="exam-title">Title</Label>
              <Input
                id="exam-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1.5"
                placeholder="Midterm 1"
              />
            </div>

            <div>
              <Label htmlFor="exam-desc">Description</Label>
              <Textarea
                id="exam-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes for students before they start."
                className="mt-1.5"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <DateTimePicker
                id="exam-start"
                label="Начало"
                value={startsAt}
                onChange={setStartsAt}
                minDate={mode === "create" ? new Date() : undefined}
                presets={startPresets}
              />
              <DateTimePicker
                id="exam-end"
                label="Конец"
                value={endsAt}
                onChange={setEndsAt}
                minDate={startsAt ? new Date(startsAt) : (mode === "create" ? new Date() : undefined)}
                durationFromValue={startsAt}
                presets={endPresets}
              />
              <div>
                <Label htmlFor="exam-dur">Длительность (мин)</Label>
                <Input
                  id="exam-dur"
                  type="number"
                  min={1}
                  max={24 * 60}
                  required
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value || "0", 10))}
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Datetime-local helpers ─────────────────────────────────────────────── */
// (removed — now uses DateTimePicker which emits ISO directly)
