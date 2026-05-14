/**
 * Public contest list (`/contests`).
 *
 * Status tabs (upcoming / running / finished) map 1:1 to the backend's
 * `GET /api/contests?status=<tab>` filter. Registration here is a quick
 * action for the row itself — the detail page at `/contests/:slug` is
 * where participants go to actually see problems, register / unregister
 * explicitly, and participate.
 *
 * `isRegistered` is carried on each `ContestListItem` directly from the
 * backend (it LEFT JOINs `contest_registrations` on the current actor),
 * so the button state survives navigation without any client-side
 * cache. After a successful register the list is reloaded so the flip
 * reflects the authoritative source.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Trophy, Users, ChevronRight, Check, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "~/components/ui/tabs";
import type {
  ContestListItem, ContestListPage, ContestStatus,
} from "~/lib/teaching-types";
import { formatDateTime } from "~/lib/format";

const TABS: ContestStatus[] = ["upcoming", "running", "finished"];
const TAB_LABEL: Record<ContestStatus, string> = {
  upcoming: "Upcoming",
  running:  "Running",
  finished: "Finished",
};
const PAGE_SIZE = 20;

export default function ContestsPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const [tab, setTab] = useState<ContestStatus>("upcoming");

  return (
    <>
      <PageHeader
        title="Contests"
        description="Timed competitive-programming events. Register ahead of time, then participate live for a ranked result."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ContestStatus)}>
        <TabsList className="mb-5">
          {TABS.map(t => (
            <TabsTrigger key={t} value={t}>{TAB_LABEL[t]}</TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(t => (
          <TabsContent key={t} value={t}>
            <ContestListPanel status={t} active={tab === t} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function ContestListPanel({ status, active }: { status: ContestStatus; active: boolean }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContestListPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the in-flight POST is tracked locally — the `isRegistered`
  // flag itself is sourced from the list response, so the button
  // state survives navigating away and back.
  const [registering, setRegistering] = useState<Record<string, boolean>>({});

  // Reset pagination whenever the tab changes.
  useEffect(() => { setPage(1); }, [status]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("status", status);
      q.set("page", String(page));
      q.set("pageSize", String(PAGE_SIZE));
      setData(await api<ContestListPage>(`/contests?${q.toString()}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load contests");
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    if (!active) return;
    reload();
  }, [active, reload]);

  async function handleRegister(c: ContestListItem) {
    setRegistering(prev => ({ ...prev, [c.slug]: true }));
    try {
      await api(`/contests/${c.slug}/register`, { method: "POST" });
      toast.success(`Registered for "${c.title}"`);
      // Re-fetch so `isRegistered` flips via the authoritative source
      // rather than a client-side override.
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Idempotent from the user's perspective — reload so the row's
        // `isRegistered` catches up and the button reflects reality.
        await reload();
      } else {
        toast.error(e instanceof ApiError ? e.message : "Could not register");
      }
    } finally {
      setRegistering(prev => ({ ...prev, [c.slug]: false }));
    }
  }

  if (loading && !data) return <Loading />;

  if (error) {
    return (
      <Empty
        icon={Trophy}
        title="Could not load contests"
        description={error}
        action={<Button variant="outline" size="sm" onClick={reload}>Try again</Button>}
      />
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Empty
        icon={Trophy}
        title={`No ${TAB_LABEL[status].toLowerCase()} contests`}
        description={
          status === "upcoming"
            ? "Nothing scheduled right now. Check back soon."
            : status === "running"
              ? "No contests are running at the moment."
              : "No past contests yet."
        }
      />
    );
  }

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1);

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map(c => (
          <ContestCard
            key={c.slug}
            contest={c}
            registered={!!c.isRegistered}
            registering={!!registering[c.slug]}
            onRegister={() => handleRegister(c)}
          />
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {data.page} of {totalPages} ({data.total} contest{data.total === 1 ? "" : "s"})
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={data.page <= 1}
              onClick={() => setPage(p => Math.max(p - 1, 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={data.page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function ContestCard({
  contest, registered, registering, onRegister,
}: {
  contest: ContestListItem;
  registered: boolean;
  registering: boolean;
  onRegister: () => void;
}) {
  return (
    <li className="group rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-primary/40 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/contests/${contest.slug}`} className="flex items-start gap-3 min-w-0 flex-1">
          <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
            <Trophy className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-base leading-tight truncate group-hover:text-primary transition-colors">
              {contest.title}
            </h3>
            <code className="text-[11px] text-muted-foreground">{contest.slug}</code>
          </div>
        </Link>
        <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={contest.status} />
        {!contest.isPublic && (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Lock className="size-3" /> Private
          </Badge>
        )}
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>
          <span className="text-foreground">Starts:</span>{" "}
          {formatDateTime(contest.startsAt)}
        </div>
        <div>
          <span className="text-foreground">Ends:</span>{" "}
          {formatDateTime(contest.endsAt)}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-auto">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Users className="size-3" /> {contest.participantCount} registered
        </span>
        {contest.status === "upcoming" && (
          registered ? (
            <Button size="sm" variant="outline" disabled>
              <Check className="size-4 mr-1.5" /> Registered
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onRegister}
              disabled={registering}
            >
              {registering ? "Registering…" : "Register"}
            </Button>
          )
        )}
      </div>
    </li>
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
