/**
 * Instructor / admin contest management (`/teach/contests/:slug`).
 *
 * Three tabs driven by `?tab=...` (mirrors `/teach/courses/:slug`):
 *
 *   - Info      — edit title, description, startsAt, endsAt,
 *                 freezeMinutes, isPublic. Disabled once the contest
 *                 starts (backend returns 409 CONTEST_ALREADY_STARTED).
 *   - Problems  — attach problems under a letter (A–Z) via a searchable
 *                 combobox like SyllabusPanel, detach individual
 *                 letters. Also disabled after the contest starts.
 *   - Editorial — markdown textarea + "Publish" button against
 *                 PUT /api/contests/:slug/editorial.
 *
 * Header actions:
 *
 *   - Back link to /teach/contests.
 *   - Delete (ADMIN-only; STUDENT/INSTRUCTOR will see a 403 toast).
 *   - Finalize ratings (ADMIN-only, appears at the bottom of the page
 *     after the contest has finished).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  AlertCircle, ArrowLeft, Calendar, CheckSquare, FileText, Info, ListOrdered,
  Lock, Plus, Save, Search, Send, Snowflake, Square, Trash2, Trophy, Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { RoleGuard, Loading } from "~/lib/guards";
import { useAuth } from "~/lib/auth";
import { Empty } from "~/components/common/Empty";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "~/components/ui/tabs";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "~/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { isAdmin } from "~/lib/types";
import type {
  ContestDetail, ContestEditorial, ContestProblemRef, ContestStatus,
} from "~/lib/teaching-types";
import type { ProblemSummary } from "~/lib/types";
import { formatDateTime } from "~/lib/format";
import { DateTimePicker } from "~/components/common/DateTimePicker";
import { addDays, addMinutes, tomorrow9am } from "~/lib/datetime";

const VALID_TABS = ["info", "problems", "editorial"] as const;
type Tab = (typeof VALID_TABS)[number];

export default function TeachContestDetailPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const initialTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "info";

  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const reload = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      setContest(await api<ContestDetail>(`/contests/${slug}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load contest");
      setContest(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { reload(); }, [reload]);

  function setTab(t: Tab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    setSearchParams(next, { replace: true });
  }

  async function doDelete() {
    setPendingDelete(false);
    try {
      await api(`/contests/${slug}`, { method: "DELETE" });
      toast.success("Contest deleted");
      navigate("/teach/contests");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        toast.error("Only admins can delete contests");
      } else {
        toast.error(e instanceof ApiError ? e.message : "Could not delete contest");
      }
    }
  }

  async function doFinalize() {
    setFinalizing(true);
    try {
      await api(`/contests/${slug}/finalize-ratings`, { method: "POST" });
      toast.success("Ratings finalized");
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not finalize ratings");
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) return <Loading />;
  if (error || !contest) {
    return (
      <Empty
        icon={AlertCircle}
        title="Could not load this contest"
        description={error ?? "It may not exist or you may not have access."}
        action={
          <Button asChild>
            <Link to="/teach/contests"><ArrowLeft className="size-4 mr-1.5" />Back to contests</Link>
          </Button>
        }
      />
    );
  }

  const started = new Date(contest.startsAt).getTime() <= Date.now();

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
            <Link to="/teach/contests"><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight truncate">
              {contest.title}
            </h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
              <code className="text-xs">{contest.slug}</code>
              <span>·</span>
              <StatusBadge status={contest.status} />
              {!contest.isPublic && (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <Lock className="size-3" /> Private
                </Badge>
              )}
              <span>·</span>
              <span className="flex items-center gap-1">
                <Users className="size-3" /> {contest.participantCount} registered
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm">
            <Link to={`/contests/${contest.slug}`}>View student page</Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPendingDelete(true)}
            className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
          >
            <Trash2 className="size-4 mr-1.5" /> Delete
          </Button>
        </div>
      </div>

      <Tabs value={initialTab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-5">
          <TabsTrigger value="info"><Info className="size-4 mr-1.5" />Info</TabsTrigger>
          <TabsTrigger value="problems"><ListOrdered className="size-4 mr-1.5" />Problems</TabsTrigger>
          <TabsTrigger value="editorial"><FileText className="size-4 mr-1.5" />Editorial</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <InfoPanel contest={contest} started={started} onSaved={reload} />
        </TabsContent>
        <TabsContent value="problems">
          <ProblemsPanel contest={contest} started={started} onChanged={reload} />
        </TabsContent>
        <TabsContent value="editorial">
          <EditorialPanel contest={contest} />
        </TabsContent>
      </Tabs>

      {contest.status === "finished" && isAdmin(user) && (
        <div className="mt-10 rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Trophy className="size-4 text-amber-500" /> Finalize ratings
              </h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-prose">
                Computes Glicko-2 rating changes for all live participants and
                persists them. Idempotent — running it again is a no-op if
                ratings have already been finalized.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={finalizing}
              onClick={doFinalize}
            >
              {finalizing ? "Finalizing…" : "Finalize ratings"}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contest?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting <strong>{contest.title}</strong> cascades to its problem
              attachments, registrations, participations, and rating changes.
              Only admins may perform this action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              className="bg-rose-500 hover:bg-rose-500/90 text-white"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── Info tab ──────────────────────────────────────────────────────────── */

function InfoPanel({
  contest, started, onSaved,
}: {
  contest: ContestDetail;
  started: boolean;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(contest.title);
  const [description, setDescription] = useState(contest.description || "");
  // ISO strings (DateTimePicker emits ISO directly).
  const [startsAt, setStartsAt] = useState<string | null>(contest.startsAt);
  const [endsAt, setEndsAt] = useState<string | null>(contest.endsAt);
  const [freezeMinutes, setFreezeMinutes] = useState(contest.freezeMinutes);
  const [isPublic, setIsPublic] = useState(contest.isPublic);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!startsAt || !endsAt) {
      toast.error("Выберите даты начала и окончания");
      return;
    }
    if (!(new Date(endsAt) > new Date(startsAt))) {
      toast.error("End time must be after start time");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/contests/${contest.slug}`, {
        method: "PUT",
        body: {
          title: title.trim(),
          description: description.trim() || undefined,
          startsAt,
          endsAt,
          freezeMinutes,
          isPublic,
        },
      });
      toast.success("Saved changes");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save contest");
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
    <form onSubmit={submit} className="space-y-4 max-w-2xl">
      {started && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-2 text-sm flex items-center gap-2">
          <AlertCircle className="size-4" />
          Contest has started. Editing is locked (the backend returns 409
          CONTEST_ALREADY_STARTED). Delete is still available.
        </div>
      )}

      <div>
        <Label htmlFor="ct-title">Title</Label>
        <Input
          id="ct-title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={started}
          className="mt-1.5"
        />
      </div>

      <div>
        <Label htmlFor="ct-desc">Description</Label>
        <Textarea
          id="ct-desc"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={started}
          className="mt-1.5"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <DateTimePicker
          id="ct-starts"
          label="Начало"
          value={startsAt}
          onChange={setStartsAt}
          minDate={new Date()}
          presets={startPresets}
          disabled={started}
        />
        <DateTimePicker
          id="ct-ends"
          label="Конец"
          value={endsAt}
          onChange={setEndsAt}
          minDate={startsAt ? new Date(startsAt) : new Date()}
          durationFromValue={startsAt}
          presets={endPresets}
          disabled={started}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 items-end">
        <div>
          <Label htmlFor="ct-freeze">
            <span className="inline-flex items-center gap-1.5">
              <Snowflake className="size-3.5" /> Freeze (minutes before end)
            </span>
          </Label>
          <Input
            id="ct-freeze"
            type="number"
            min={0}
            max={1440}
            value={freezeMinutes}
            onChange={(e) => setFreezeMinutes(parseInt(e.target.value || "0", 10))}
            disabled={started}
            className="mt-1.5"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            disabled={started}
            className="size-4 rounded border-border accent-primary"
          />
          <span>Public (visible to all authenticated users)</span>
        </label>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Calendar className="size-3" />
        Currently: {formatDateTime(contest.startsAt)} → {formatDateTime(contest.endsAt)}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting || started}>
          <Save className="size-4 mr-1.5" />
          {submitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/* ─── Problems tab ──────────────────────────────────────────────────────── */

function ProblemsPanel({
  contest, started, onChanged,
}: {
  contest: ContestDetail;
  started: boolean;
  onChanged: () => void;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingDetach, setPendingDetach] = useState<ContestProblemRef | null>(null);

  async function detach(p: ContestProblemRef) {
    setPendingDetach(null);
    try {
      await api(`/contests/${contest.slug}/problems/${p.letter}`, { method: "DELETE" });
      toast.success(`Removed problem ${p.letter}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not detach problem");
    }
  }

  const sorted = useMemo(
    () => [...contest.problems].sort((a, b) => a.letter.localeCompare(b.letter)),
    [contest.problems],
  );

  const usedLetters = useMemo(() => new Set(sorted.map(p => p.letter)), [sorted]);
  const attachedSlugs = useMemo(
    () => sorted.map(p => p.slug).filter((s): s is string => !!s),
    [sorted],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Each problem is assigned a letter (A–Z) used on the standings
          and in the participant workspace.
        </p>
        <Button
          onClick={() => setAttachOpen(true)}
          size="sm"
          disabled={started}
          title={started ? "Cannot change problems after the contest starts" : "Attach problem"}
        >
          <Plus className="size-4 mr-1.5" /> Attach problem
        </Button>
      </div>

      {started && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-2 text-sm flex items-center gap-2">
          <AlertCircle className="size-4" />
          Problem set is frozen — the contest has started.
        </div>
      )}

      {sorted.length === 0 ? (
        <Empty
          icon={ListOrdered}
          title="No problems attached yet"
          description="Attach problems from the catalog and give each a letter (A, B, C, …)."
          action={
            <Button onClick={() => setAttachOpen(true)} disabled={started}>
              <Plus className="size-4 mr-1.5" /> Attach the first problem
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border">
            {sorted.map(p => (
              <li key={p.letter} className="grid grid-cols-12 gap-3 px-4 py-3 hover:bg-accent/30 transition-colors items-center">
                <div className="col-span-1">
                  <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold">
                    {p.letter}
                  </span>
                </div>
                <div className="col-span-12 sm:col-span-8">
                  {p.slug ? (
                    <Link to={`/problems/${p.slug}`} className="font-medium hover:text-primary truncate block">
                      {p.title}
                    </Link>
                  ) : (
                    <span className="font-medium block truncate">{p.title}</span>
                  )}
                  {p.slug && <code className="text-xs text-muted-foreground">{p.slug}</code>}
                </div>
                <div className="col-span-6 sm:col-span-2 flex items-center gap-2">
                  {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
                  {p.problemType && (
                    <span className="text-[10px] text-muted-foreground">{p.problemType}</span>
                  )}
                </div>
                <div className="col-span-6 sm:col-span-1 flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDetach(p)}
                    disabled={started}
                    title={started ? "Cannot detach after the contest starts" : "Detach"}
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

      <AttachContestProblemDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        slug={contest.slug}
        usedLetters={usedLetters}
        attachedSlugs={attachedSlugs}
        onAttached={onChanged}
      />

      <AlertDialog open={!!pendingDetach} onOpenChange={(o) => !o && setPendingDetach(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove problem {pendingDetach?.letter} from contest?</AlertDialogTitle>
            <AlertDialogDescription>
              The problem itself stays in the catalog. Only this
              contest-link and its letter assignment are removed.
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

function AttachContestProblemDialog({
  open, onOpenChange, slug, usedLetters, attachedSlugs, onAttached,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  usedLetters: Set<string>;
  attachedSlugs: string[];
  onAttached: () => void;
}) {
  const [catalog, setCatalog] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Available letters (not yet used by already-attached problems).
  const availableLetters = useMemo(() => {
    const letters: string[] = [];
    for (const code of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      if (!usedLetters.has(code)) letters.push(code);
    }
    return letters;
  }, [usedLetters]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(new Set());
    setLoading(true);
    api<{ items: ProblemSummary[]; total: number; page: number; pageSize: number }>(
      "/problems?pageSize=200",
    )
      .then((r) => setCatalog(r.items || []))
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not load problems"))
      .finally(() => setLoading(false));
  }, [open]);

  const attachedSet = useMemo(() => new Set(attachedSlugs), [attachedSlugs]);

  // All available (non-attached) problems — used for "select all" logic.
  const available = useMemo(
    () => catalog.filter(p => !attachedSet.has(p.slug)),
    [catalog, attachedSet],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available.slice(0, 50);
    return available.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q)),
    ).slice(0, 50);
  }, [available, query]);

  // Letter assignments preview: map each selected problem to the next available letter.
  const assignments = useMemo(() => {
    const result: { problem: ProblemSummary; letter: string }[] = [];
    // Maintain selection order based on catalog order for deterministic assignment.
    const orderedSelected = available.filter(p => selected.has(p.slug));
    for (let i = 0; i < orderedSelected.length; i++) {
      const letter = i < availableLetters.length ? availableLetters[i] : "";
      result.push({ problem: orderedSelected[i], letter });
    }
    return result;
  }, [selected, available, availableLetters]);

  const notEnoughLetters = selected.size > availableLetters.length;

  function toggleProblem(problemSlug: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(problemSlug)) {
        next.delete(problemSlug);
      } else {
        next.add(problemSlug);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === available.length) {
      // Deselect all.
      setSelected(new Set());
    } else {
      // Select all available.
      setSelected(new Set(available.map(p => p.slug)));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0 || notEnoughLetters) return;
    setSubmitting(true);
    let successCount = 0;
    let lastError: string | null = null;
    for (const { problem, letter } of assignments) {
      if (!letter) break;
      try {
        await api(`/contests/${slug}/problems`, {
          method: "POST",
          body: { problemSlug: problem.slug, letter },
        });
        successCount++;
      } catch (e) {
        lastError = e instanceof ApiError ? e.message : "Could not attach problem";
      }
    }
    setSubmitting(false);
    if (successCount > 0) {
      toast.success(`Добавлено задач: ${successCount}`);
    }
    if (lastError) {
      toast.error(lastError);
    }
    onOpenChange(false);
    onAttached();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Добавить задачи в контест</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 my-3">
            {/* Search */}
            <div>
              <Label htmlFor="problem-search">Поиск задач</Label>
              <div className="relative mt-1.5">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="problem-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск по названию, slug или тегу…"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Select all / Deselect all toggle */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline flex items-center gap-1.5"
              >
                {selected.size === available.length && available.length > 0 ? (
                  <><Square className="size-3.5" /> Снять выделение</>
                ) : (
                  <><CheckSquare className="size-3.5" /> Выбрать все</>
                )}
              </button>
              {selected.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  Выбрано: {selected.size}
                </span>
              )}
            </div>

            {/* Problem list with checkboxes */}
            <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-card">
              {loading ? (
                <div className="p-4 text-sm text-muted-foreground">Загрузка каталога…</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {catalog.length === 0
                    ? "В каталоге нет задач. Сначала создайте задачу."
                    : attachedSet.size > 0 && catalog.every(p => attachedSet.has(p.slug))
                      ? "Все задачи из каталога уже добавлены."
                      : "Нет задач, соответствующих поиску."}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map(p => {
                    const isChecked = selected.has(p.slug);
                    return (
                      <li key={p.slug}>
                        <button
                          type="button"
                          onClick={() => toggleProblem(p.slug)}
                          className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-accent/50 transition-colors ${
                            isChecked ? "bg-primary/5" : ""
                          }`}
                        >
                          <Checkbox
                            checked={isChecked}
                            tabIndex={-1}
                            className="pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate text-sm">{p.title}</div>
                            <code className="text-xs text-muted-foreground">{p.slug}</code>
                          </div>
                          <DifficultyBadge difficulty={p.difficulty} />
                          {p.problemType && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {p.problemType}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Letter assignment preview */}
            {assignments.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Назначение букв</Label>
                <div className="max-h-28 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
                  {assignments.map(({ problem, letter }) => (
                    <div key={problem.slug} className="flex items-center gap-2 text-sm">
                      {letter ? (
                        <span className="inline-flex size-5 items-center justify-center rounded bg-primary/10 text-primary text-xs font-semibold shrink-0">
                          {letter}
                        </span>
                      ) : (
                        <span className="inline-flex size-5 items-center justify-center rounded bg-rose-500/10 text-rose-500 text-xs font-semibold shrink-0">
                          ?
                        </span>
                      )}
                      <span className="truncate">{problem.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error: not enough letters */}
            {notEnoughLetters && (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3 py-2 text-sm flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                Недостаточно свободных букв. Доступно: {availableLetters.length}, выбрано: {selected.size}.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={submitting || selected.size === 0 || notEnoughLetters}>
              {submitting
                ? "Добавление…"
                : selected.size > 0
                  ? `Добавить (${selected.size})`
                  : "Добавить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Editorial tab ─────────────────────────────────────────────────────── */

function EditorialPanel({ contest }: { contest: ContestDetail }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<ContestEditorial>(`/contests/${contest.slug}/editorial`)
      .then((r) => { if (!cancelled) setContent(r.content || ""); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          if (!cancelled) setContent("");
        } else {
          toast.error(e instanceof ApiError ? e.message : "Could not load editorial");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contest.slug]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) {
      toast.error("Editorial cannot be empty");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/contests/${contest.slug}/editorial`, {
        method: "PUT",
        body: { content },
      });
      toast.success("Editorial published");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not publish editorial");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <form onSubmit={publish} className="space-y-3 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Supports plain text and markdown. Students see the editorial
        once the contest has ended.
      </p>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={18}
        placeholder={
          "## Problem A — Overview\n\n" +
          "Idea: …\n\nIntended complexity: O(n log n).\n\n" +
          "```cpp\n// reference solution\n```"
        }
        className="font-mono text-sm"
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          <Send className="size-4 mr-1.5" />
          {submitting ? "Publishing…" : "Publish editorial"}
        </Button>
      </div>
    </form>
  );
}

/* ─── shared status badge ───────────────────────────────────────────────── */

function StatusBadge({ status }: { status: ContestStatus }) {
  const cls =
    status === "running"  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
    status === "upcoming" ? "bg-sky-500/10 text-sky-500 border-sky-500/20" :
                            "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cls}>
      {status === "running" ? "Live" : status === "upcoming" ? "Upcoming" : "Finished"}
    </Badge>
  );
}
