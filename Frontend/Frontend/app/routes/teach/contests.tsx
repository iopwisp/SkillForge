/**
 * Instructor / admin contest list (`/teach/contests`).
 *
 * Lists every contest the actor can see (INSTRUCTOR / ADMIN see all)
 * and provides a create dialog. Card layout mirrors `/teach/courses`.
 * Each card links to `/teach/contests/:slug` for management.
 *
 * Contest creation goes through `POST /api/contests`; the list view
 * pages `GET /api/contests`.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight, Calendar, Lock, Plus, Swords, Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { RoleGuard } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Badge } from "~/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "~/components/ui/dialog";
import type { ContestListItem, ContestListPage, ContestStatus } from "~/lib/teaching-types";
import { formatDateTime } from "~/lib/format";
import { DateTimePicker } from "~/components/common/DateTimePicker";
import { addDays, addMinutes, tomorrow9am } from "~/lib/datetime";

const PAGE_SIZE = 100;

export default function TeachContestsPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const [items, setItems] = useState<ContestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<ContestListPage>(`/contests?pageSize=${PAGE_SIZE}`);
      setItems(res.items || []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load contests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <PageHeader
        title="Contests"
        description="Create and manage competitive-programming contests. Each contest carries a problem set, standings, and optional Glicko-2 rating finalization after it ends."
        action={
          <Button onClick={() => setCreateOpen(true)} className="gradient-bg text-white border-0">
            <Plus className="size-4 mr-1.5" /> New contest
          </Button>
        }
      />

      {loading ? (
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : items.length === 0 ? (
        <Empty
          icon={Swords}
          title="No contests yet"
          description="Create a contest to schedule a timed competitive-programming event for your students."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 mr-1.5" /> New contest
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map(c => (
            <Link
              key={c.slug}
              to={`/teach/contests/${c.slug}`}
              className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold truncate">{c.title}</h3>
                  <code className="text-xs text-muted-foreground">{c.slug}</code>
                </div>
                <ArrowRight className="size-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <StatusBadge status={c.status} />
                {!c.isPublic && (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <Lock className="size-3" /> Private
                  </Badge>
                )}
              </div>

              <div className="mt-3 text-xs text-muted-foreground space-y-0.5">
                <div className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  <span>{formatDateTime(c.startsAt)} → {formatDateTime(c.endsAt)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Users className="size-3" />
                  <span>{c.participantCount} registered</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateContestDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={reload}
      />
    </>
  );
}

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

/* ─── create dialog ────────────────────────────────────────────────────── */

function CreateContestDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // ISO strings (not datetime-local strings) — DateTimePicker emits ISO directly.
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [freezeMinutes, setFreezeMinutes] = useState(30);
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [startsAtError, setStartsAtError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlug("");
    setTitle("");
    setDescription("");
    setStartsAt(null);
    setEndsAt(null);
    setFreezeMinutes(30);
    setIsPublic(true);
    setStartsAtError(null);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStartsAtError(null);

    if (!startsAt || !endsAt) {
      toast.error("Выберите даты начала и окончания");
      return;
    }

    // Matches the backend `CreateContestSchema` refine so the obvious
    // error is caught client-side rather than round-tripping.
    if (!(new Date(startsAt).getTime() > Date.now())) {
      setStartsAtError("Start time must be in the future");
      return;
    }
    if (!(new Date(endsAt) > new Date(startsAt))) {
      toast.error("End time must be after start time");
      return;
    }
    setSubmitting(true);
    try {
      await api("/contests", {
        method: "POST",
        body: {
          slug: slug.trim(),
          title: title.trim(),
          description: description.trim() || undefined,
          startsAt,
          endsAt,
          freezeMinutes,
          isPublic,
        },
      });
      toast.success(`Created "${title}"`);
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create contest");
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
            <DialogTitle>New contest</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 my-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="contest-slug">Slug</Label>
                <Input
                  id="contest-slug"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="spring-2026-round-1"
                  className="mt-1.5 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="contest-title">Title</Label>
                <Input
                  id="contest-title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Spring 2026 Round 1"
                  className="mt-1.5"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="contest-desc">Description (optional)</Label>
              <Textarea
                id="contest-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Rules, prizes, eligibility, format notes…"
                className="mt-1.5"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <DateTimePicker
                  id="contest-starts"
                  label="Начало"
                  value={startsAt}
                  onChange={(iso) => {
                    setStartsAt(iso);
                    setStartsAtError(null);
                  }}
                  minDate={new Date()}
                  error={startsAtError}
                  presets={startPresets}
                />
              </div>
              <div>
                <DateTimePicker
                  id="contest-ends"
                  label="Конец"
                  value={endsAt}
                  onChange={setEndsAt}
                  minDate={startsAt ? new Date(startsAt) : new Date()}
                  durationFromValue={startsAt}
                  presets={endPresets}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 items-end">
              <div>
                <Label htmlFor="contest-freeze">Freeze (minutes before end)</Label>
                <Input
                  id="contest-freeze"
                  type="number"
                  min={0}
                  max={1440}
                  value={freezeMinutes}
                  onChange={(e) => setFreezeMinutes(parseInt(e.target.value || "0", 10))}
                  className="mt-1.5"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="size-4 rounded border-border accent-primary"
                />
                <span>Public (visible to all authenticated users)</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting} className="gradient-bg text-white border-0">
              {submitting ? "Creating…" : "Create contest"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
