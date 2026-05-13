/**
 * Contest detail page (`/contests/:slug`).
 *
 * Four tabs driven by `?tab=...` so refreshing or sharing a URL lands
 * the recipient on the same panel (mirrors the pattern used on
 * `teach/course-detail.tsx`):
 *
 *   - Info       — description, time window, freeze config, registration
 *                  + participation status, participant count.
 *   - Problems   — letter list (statements hidden before start; during /
 *                  after start each row links to the per-problem workspace
 *                  at `/contests/:slug/problems/:letter`).
 *   - Standings  — teaser panel with a link to the full standings page
 *                  at `/contests/:slug/standings` (built in task 20.1).
 *   - Editorial  — fetches `GET /api/contests/:slug/editorial`; empty
 *                  state on 404 (not published yet, or contest not ended).
 *
 * The header carries the phase-sensitive action button(s):
 *
 *   upcoming + !registered     → Register
 *   upcoming + registered      → "Registered" + Unregister
 *   running + !participating   → Participate (requires prior registration)
 *   running + participating    → Enter workspace → /problems/:firstLetter
 *   finished + !participating  → Virtual Join
 *   finished + participating   → Enter workspace (usually virtual)
 *
 * During an active participation a 1-second countdown is shown based
 * on `participation.personalDeadline`. When the deadline expires the
 * Enter-workspace link becomes disabled and "Time expired" is shown.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft, AlertCircle, CalendarClock, Check, ChevronRight, Clock,
  FileText, Info, Lock, ListOrdered, PlayCircle, Snowflake, Timer,
  Trophy, UserCheck, UserMinus, Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "~/components/ui/tabs";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { formatDateTime } from "~/lib/format";
import type {
  ContestDetail, ContestEditorial, ContestStatus,
} from "~/lib/teaching-types";

const VALID_TABS = ["info", "problems", "standings", "editorial"] as const;
type Tab = (typeof VALID_TABS)[number];

export default function ContestDetailPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const initialTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "info";

  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  async function handleAction(
    path: string,
    method: "POST" | "DELETE",
    label: string,
  ) {
    setPending(true);
    try {
      await api(path, { method });
      toast.success(label);
      await reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Action failed";
      toast.error(msg);
    } finally {
      setPending(false);
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
            <Link to="/contests"><ArrowLeft className="size-4 mr-1.5" />Back to contests</Link>
          </Button>
        }
      />
    );
  }

  const firstLetter = contest.problems[0]?.letter;

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
            <Link to="/contests"><ArrowLeft className="size-4" /></Link>
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
        <ActionButtons
          contest={contest}
          pending={pending}
          firstLetter={firstLetter}
          onAction={handleAction}
          navigate={navigate}
        />
      </div>

      <Tabs value={initialTab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-5">
          <TabsTrigger value="info"><Info className="size-4 mr-1.5" />Info</TabsTrigger>
          <TabsTrigger value="problems"><ListOrdered className="size-4 mr-1.5" />Problems</TabsTrigger>
          <TabsTrigger value="standings"><Trophy className="size-4 mr-1.5" />Standings</TabsTrigger>
          <TabsTrigger value="editorial"><FileText className="size-4 mr-1.5" />Editorial</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <InfoPanel contest={contest} />
        </TabsContent>
        <TabsContent value="problems">
          <ProblemsPanel contest={contest} />
        </TabsContent>
        <TabsContent value="standings">
          <StandingsTeaser contest={contest} />
        </TabsContent>
        <TabsContent value="editorial">
          <EditorialPanel slug={contest.slug} status={contest.status} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ─── action buttons ────────────────────────────────────────────────────── */

function ActionButtons({
  contest, pending, firstLetter, onAction, navigate,
}: {
  contest: ContestDetail;
  pending: boolean;
  firstLetter: string | undefined;
  onAction: (path: string, method: "POST" | "DELETE", label: string) => Promise<void>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { slug, status, isRegistered, isParticipating, participation } = contest;
  const deadlineMs = participation ? new Date(participation.personalDeadline).getTime() : 0;
  const expired = isParticipating && Date.now() >= deadlineMs;
  const enterWorkspace = () => {
    if (firstLetter) navigate(`/contests/${slug}/problems/${firstLetter}`);
  };

  // upcoming
  if (status === "upcoming") {
    if (!isRegistered) {
      return (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onAction(`/contests/${slug}/register`, "POST", "Registered")}
          >
            <UserCheck className="size-4 mr-1.5" /> Register
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" disabled>
          <Check className="size-4 mr-1.5" /> Registered
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onAction(`/contests/${slug}/register`, "DELETE", "Unregistered")}
        >
          <UserMinus className="size-4 mr-1.5" /> Unregister
        </Button>
      </div>
    );
  }

  // running
  if (status === "running") {
    if (!isParticipating) {
      if (!isRegistered) {
        return (
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" disabled>
              Register first to participate
            </Button>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onAction(`/contests/${slug}/participate`, "POST", "Participation started")}
          >
            <PlayCircle className="size-4 mr-1.5" /> Participate
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          disabled={!firstLetter || expired}
          onClick={enterWorkspace}
        >
          <PlayCircle className="size-4 mr-1.5" />
          {expired ? "Time expired" : "Enter workspace"}
        </Button>
      </div>
    );
  }

  // finished
  if (!isParticipating) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onAction(`/contests/${slug}/participate?virtual=true`, "POST", "Virtual participation started")}
        >
          <PlayCircle className="size-4 mr-1.5" /> Virtual Join
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button
        size="sm"
        disabled={!firstLetter || expired}
        onClick={enterWorkspace}
      >
        <PlayCircle className="size-4 mr-1.5" />
        {expired ? "Time expired" : "Enter workspace"}
      </Button>
    </div>
  );
}

/* ─── Info tab ──────────────────────────────────────────────────────────── */

function InfoPanel({ contest }: { contest: ContestDetail }) {
  const durationMin = Math.max(
    Math.round((new Date(contest.endsAt).getTime() - new Date(contest.startsAt).getTime()) / 60000),
    0,
  );
  return (
    <div className="space-y-6">
      {contest.description && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Description</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed max-w-3xl">
            {contest.description}
          </pre>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoStat
          icon={CalendarClock}
          label="Starts"
          value={formatDateTime(contest.startsAt)}
        />
        <InfoStat
          icon={CalendarClock}
          label="Ends"
          value={formatDateTime(contest.endsAt)}
        />
        <InfoStat
          icon={Timer}
          label="Duration"
          value={`${durationMin} min`}
        />
        <InfoStat
          icon={Snowflake}
          label="Freeze"
          value={contest.freezeMinutes > 0 ? `${contest.freezeMinutes} min before end` : "No freeze"}
        />
        <InfoStat
          icon={Users}
          label="Participants"
          value={String(contest.participantCount)}
        />
        <InfoStat
          icon={Lock}
          label="Visibility"
          value={contest.isPublic ? "Public" : "Private"}
        />
      </div>

      <ParticipationCard contest={contest} />
    </div>
  );
}

function InfoStat({
  icon: Icon, label, value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className="rounded-lg bg-primary/10 p-2 shrink-0">
        <Icon className="size-4 text-primary" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}

function ParticipationCard({ contest }: { contest: ContestDetail }) {
  const { isRegistered, isParticipating, participation, status } = contest;

  if (isParticipating && participation) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-2 text-sm font-medium">
          <PlayCircle className="size-4 text-primary" />
          {participation.isVirtual ? "Virtual participation active" : "Participation active"}
        </div>
        <Countdown deadline={participation.personalDeadline} />
        <div className="mt-2 text-xs text-muted-foreground">
          Started {formatDateTime(participation.startedAt)}
          {" · "}
          Deadline {formatDateTime(participation.personalDeadline)}
        </div>
      </div>
    );
  }

  if (status === "upcoming") {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
        {isRegistered
          ? "You are registered. The contest hasn't started yet."
          : "Registration is open. Sign up before the contest starts."}
      </div>
    );
  }

  if (status === "running") {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
        {isRegistered
          ? "The contest is running. Click Participate to start your personal timer."
          : "Registration is closed. You can join this contest virtually after it ends."}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
      Contest has ended. You can still practice virtually under contest conditions.
    </div>
  );
}

function Countdown({ deadline }: { deadline: string }) {
  const end = useMemo(() => new Date(deadline).getTime(), [deadline]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(end - now, 0);
  const expired = remainingMs === 0;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className={`font-mono text-2xl tracking-tight ${expired ? "text-muted-foreground" : "text-foreground"}`}>
      {expired ? "Time expired" : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
    </div>
  );
}

/* ─── Problems tab ──────────────────────────────────────────────────────── */

function ProblemsPanel({ contest }: { contest: ContestDetail }) {
  const hidden = contest.status === "upcoming";

  if (contest.problems.length === 0) {
    return (
      <Empty
        icon={ListOrdered}
        title="No problems attached"
        description="Nothing in the problem set for this contest yet."
      />
    );
  }

  if (hidden) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
          <Lock className="size-3.5" />
          Problem statements are hidden until the contest starts.
        </div>
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {contest.problems.map((p) => (
            <div key={p.letter} className="flex items-center gap-3 px-4 py-3">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold">
                {p.letter}
              </span>
              <span className="font-medium text-sm text-muted-foreground">???</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border">
      {contest.problems.map((p) => (
        <Link
          key={p.letter}
          to={`/contests/${contest.slug}/problems/${p.letter}`}
          className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors group"
        >
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold">
            {p.letter}
          </span>
          <span className="font-medium text-sm flex-1 truncate group-hover:text-primary transition-colors">
            {p.title}
          </span>
          {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
          <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </Link>
      ))}
    </div>
  );
}

/* ─── Standings tab ─────────────────────────────────────────────────────── */

function StandingsTeaser({ contest }: { contest: ContestDetail }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 flex flex-col items-start gap-3">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-primary/10 p-2">
          <Trophy className="size-5 text-primary" />
        </div>
        <h3 className="text-base font-semibold">Leaderboard</h3>
      </div>
      <p className="text-sm text-muted-foreground max-w-md">
        {contest.status === "upcoming"
          ? "Standings open once the contest starts."
          : contest.status === "running"
            ? "Watch the live standings with auto-refresh. First-solves and freeze indicators are highlighted."
            : "Review the final standings for this contest."}
      </p>
      <Button asChild size="sm">
        <Link to={`/contests/${contest.slug}/standings`}>
          Open standings <ChevronRight className="size-4 ml-1" />
        </Link>
      </Button>
    </div>
  );
}

/* ─── Editorial tab ─────────────────────────────────────────────────────── */

function EditorialPanel({ slug, status }: { slug: string; status: ContestStatus }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setError(null);
    api<ContestEditorial>(`/contests/${slug}/editorial`)
      .then((r) => { if (!cancelled) setContent(r.content); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setMissing(true);
        } else {
          setError(e instanceof ApiError ? e.message : "Could not load editorial");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) return <Loading />;

  if (missing) {
    return (
      <Empty
        icon={FileText}
        title="Editorial not available yet"
        description={
          status === "finished"
            ? "No editorial has been published for this contest."
            : "The editorial will be available after the contest ends."
        }
      />
    );
  }

  if (error) {
    return (
      <Empty
        icon={AlertCircle}
        title="Could not load the editorial"
        description={error}
      />
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
        {content}
      </pre>
    </div>
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
