/**
 * Full submission history page.
 *
 * Overhaul v1 — consistent with dashboard recent-activity styling:
 *   - Status-accent left borders via `row-accent-left`.
 *   - Flexbox columns instead of grid-cols-12.
 *   - Language tags as muted pills.
 *   - Border-subtle dividers and header row.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ScrollText } from "lucide-react";
import { api } from "~/lib/api";
import type { Submission } from "~/lib/types";
import { ProtectedRoute } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { Empty } from "~/components/common/Empty";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { formatDateTime, timeAgo } from "~/lib/format";

const STATUS_FILTER = [
  { value: "all", label: "All statuses" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "WRONG_ANSWER", label: "Wrong Answer" },
  { value: "TLE", label: "Time Limit" },
  { value: "RUNTIME_ERROR", label: "Runtime Error" },
];

export default function SubmissionsPage() {
  return <ProtectedRoute><Inner /></ProtectedRoute>;
}

function Inner() {
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    api<Submission[]>("/submissions/me").then(setItems).finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter === "all" ? items : items.filter(s => s.status === statusFilter);

  return (
    <>
      <PageHeader
        title="Submissions"
        description="Your full submission history across all problems."
        action={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTER.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Empty
          icon={ScrollText}
          title="No submissions yet"
          description="Once you submit a solution it will show up here."
          action={<Button asChild><Link to="/problems">Browse problems</Link></Button>}
        />
      ) : (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
          {/* Header */}
          <div className="hidden sm:flex items-center gap-4 px-4 py-3 border-b border-border/60 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted/30">
            <div className="flex-1 min-w-0">Problem</div>
            <div className="w-28">Status</div>
            <div className="w-16">Lang</div>
            <div className="w-16 text-right">Time</div>
            <div className="w-16 text-right">Mem</div>
            <div className="w-24 text-right">When</div>
          </div>
          <ul className="divide-y divide-border/40">
            {filtered.map(s => (
              <li
                key={s.id}
                className="row-accent-left"
                data-status={s.status === "ACCEPTED" ? "solved" : undefined}
              >
                <div className="flex items-center gap-4 px-4 py-3 text-sm">
                  {/* Problem */}
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <Link to={`/problems/${s.problem?.slug}`} className="font-medium hover:text-primary truncate">
                      {s.problem?.title}
                    </Link>
                    {s.problem && <DifficultyBadge difficulty={s.problem.difficulty} className="hidden sm:inline-flex" />}
                  </div>
                  {/* Status */}
                  <div className="w-28 hidden sm:flex items-center"><StatusBadge status={s.status} /></div>
                  {/* Lang */}
                  <div className="w-16 hidden sm:flex items-center">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                      {s.language}
                    </span>
                  </div>
                  {/* Time */}
                  <div className="w-16 hidden sm:flex items-center justify-end text-xs text-muted-foreground tabular-nums">
                    {s.runtimeMs ?? 0}ms
                  </div>
                  {/* Mem */}
                  <div className="w-16 hidden sm:flex items-center justify-end text-xs text-muted-foreground tabular-nums">
                    {s.memoryKb ? `${(s.memoryKb / 1024).toFixed(1)}MB` : "—"}
                  </div>
                  {/* When */}
                  <div className="w-24 hidden sm:flex items-center justify-end text-xs text-muted-foreground" title={formatDateTime(s.createdAt)}>
                    {timeAgo(s.createdAt)}
                  </div>
                  {/* Mobile: status + time inline */}
                  <div className="flex sm:hidden items-center gap-2">
                    <StatusBadge status={s.status} />
                    <span className="text-xs text-muted-foreground">{timeAgo(s.createdAt)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
