/**
 * ADMIN-only audit log viewer.
 *
 * Hits the backend's `GET /api/audit-log` (per ADR 0012). The endpoint
 * supports filtering on `action`, `actorUsername`, `entityType`, and
 * `entityKey` (substring), plus the standard pagination. Filters are
 * persisted in the URL so a deep-linked audit query can be shared.
 *
 * Each row is collapsible to reveal the JSON `details` payload; the
 * details are kept inline rather than in a side-panel to make
 * "scroll-and-skim" investigation faster.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Search, ScrollText, ChevronDown, ChevronRight, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { RoleGuard } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import type { AuditEvent, AuditLogPage } from "~/lib/teaching-types";
import { formatDateTime, timeAgo } from "~/lib/format";
import { useSearchParams } from "react-router";

const ALL = "__all__";

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "ATTACH", "DETACH", "ROLE_CHANGE"];
const ENTITY_TYPES = ["USER", "COURSE", "COURSE_PROBLEM", "GROUP", "GROUP_MEMBER", "EXAM", "EXAM_PROBLEM", "PROBLEM"];

export default function AuditLogPage() {
  return (
    <RoleGuard allowed={["ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const [params, setParams] = useSearchParams();
  const action = params.get("action") || ALL;
  const entityType = params.get("entityType") || ALL;
  const actorUsername = params.get("actorUsername") || "";
  const entityKey = params.get("entityKey") || "";
  const page = Math.max(parseInt(params.get("page") || "1", 10), 1);
  const pageSize = 50;

  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local copy of the text inputs so we don't refetch on every keystroke.
  const [actorInput, setActorInput] = useState(actorUsername);
  const [entityKeyInput, setEntityKeyInput] = useState(entityKey);

  useEffect(() => { setActorInput(actorUsername); }, [actorUsername]);
  useEffect(() => { setEntityKeyInput(entityKey); }, [entityKey]);

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    if (action !== ALL) q.set("action", action);
    if (entityType !== ALL) q.set("entityType", entityType);
    if (actorUsername) q.set("actorUsername", actorUsername);
    if (entityKey) q.set("entityKey", entityKey);
    q.set("page", String(page));
    q.set("pageSize", String(pageSize));
    return q.toString();
  }, [action, entityType, actorUsername, entityKey, page]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setData(await api<AuditLogPage>(`/audit-log?${queryString}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load audit log");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [queryString]);

  function setFilter(name: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === "" || value === ALL) next.delete(name);
    else next.set(name, value);
    next.delete("page"); // resetting filters should put us back on page 1
    setParams(next, { replace: true });
  }

  function setPage(p: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    setParams(next, { replace: true });
  }

  function applyTextFilters(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (actorInput.trim()) next.set("actorUsername", actorInput.trim());
    else next.delete("actorUsername");
    if (entityKeyInput.trim()) next.set("entityKey", entityKeyInput.trim());
    else next.delete("entityKey");
    next.delete("page");
    setParams(next, { replace: true });
  }

  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Successful privileged mutations across the installation. Failed attempts (4xx) are not logged."
        action={
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="size-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      <form
        onSubmit={applyTextFilters}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5 rounded-xl border border-border bg-card p-4"
      >
        <div>
          <Label className="text-xs uppercase tracking-wider">Action</Label>
          <Select value={action} onValueChange={(v) => setFilter("action", v)}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider">Entity type</Label>
          <Select value={entityType} onValueChange={(v) => setFilter("entityType", v)}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider">Actor username</Label>
          <Input
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            placeholder="exact username"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider">Entity key (contains)</Label>
          <div className="relative mt-1.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={entityKeyInput}
              onChange={(e) => setEntityKeyInput(e.target.value)}
              placeholder="course slug, problem slug…"
              className="pl-9"
            />
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
          <Button type="submit" size="sm">Apply text filters</Button>
        </div>
      </form>

      {loading ? (
        <div className="h-72 rounded-xl border border-border bg-card animate-pulse" />
      ) : error ? (
        <Empty icon={ScrollText} title="Audit log unavailable" description={error} />
      ) : !data || data.items.length === 0 ? (
        <Empty
          icon={ScrollText}
          title="No matching events"
          description="Try clearing the filters above or check back after instructors take some action."
        />
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <ul className="divide-y divide-border">
              {data.items.map(ev => <AuditRow key={ev.id} event={ev} />)}
            </ul>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {data.page} of {totalPages} ({data.total} event{data.total === 1 ? "" : "s"})
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                disabled={data.page <= 1}
                onClick={() => setPage(data.page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline" size="sm"
                disabled={data.page >= totalPages}
                onClick={() => setPage(data.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const hasDetails = event.details && Object.keys(event.details).length > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => hasDetails && setOpen(!open)}
        className={`w-full grid grid-cols-12 gap-3 px-4 py-2.5 text-left transition-colors ${
          hasDetails ? "hover:bg-accent/30 cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="col-span-12 sm:col-span-2 flex items-center gap-1.5 text-xs">
          {hasDetails ? (
            open ? <ChevronDown className="size-3.5 text-muted-foreground" />
                 : <ChevronRight className="size-3.5 text-muted-foreground" />
          ) : <span className="size-3.5 inline-block" />}
          <ActionPill action={event.action} />
        </div>
        <div className="col-span-12 sm:col-span-3 text-sm">
          <span className="font-medium">@{event.actor.username}</span>
          <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
            {event.actor.role}
          </span>
        </div>
        <div className="col-span-12 sm:col-span-3 text-sm flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500">
            {event.entityType}
          </span>
          <code className="text-xs text-muted-foreground truncate">{event.entityKey}</code>
        </div>
        <div className="col-span-12 sm:col-span-4 text-xs text-muted-foreground sm:text-right" title={formatDateTime(event.createdAt)}>
          {timeAgo(event.createdAt)}
        </div>
      </button>

      {open && hasDetails && (
        <pre className="px-4 pb-3 text-xs bg-muted/30 overflow-x-auto">
          <code>{JSON.stringify(event.details, null, 2)}</code>
        </pre>
      )}
    </li>
  );
}

function ActionPill({ action }: { action: string }) {
  const tone =
    action === "CREATE"  ? "bg-emerald-500/10 text-emerald-500" :
    action === "UPDATE"  ? "bg-amber-500/10 text-amber-500" :
    action === "DELETE"  ? "bg-rose-500/10 text-rose-500" :
    action === "ATTACH"  ? "bg-sky-500/10 text-sky-500" :
    action === "DETACH"  ? "bg-orange-500/10 text-orange-500" :
                           "bg-muted text-foreground";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${tone}`}>
      {action}
    </span>
  );
}
