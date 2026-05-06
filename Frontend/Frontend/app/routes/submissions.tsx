import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Filter, ScrollText } from "lucide-react";
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
        <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
      ) : filtered.length === 0 ? (
        <Empty
          icon={ScrollText}
          title="No submissions yet"
          description="Once you submit a solution it will show up here."
          action={<Button asChild><Link to="/problems">Browse problems</Link></Button>}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="hidden sm:grid grid-cols-12 gap-4 px-4 py-2.5 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="col-span-5">Problem</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">Lang</div>
            <div className="col-span-1 text-right">Time</div>
            <div className="col-span-1 text-right">Mem</div>
            <div className="col-span-2 text-right">When</div>
          </div>
          <ul className="divide-y divide-border">
            {filtered.map(s => (
              <li key={s.id} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-accent/40 transition-colors">
                <div className="col-span-12 sm:col-span-5 flex items-center gap-2 flex-wrap">
                  <Link to={`/problems/${s.problem?.slug}`} className="font-medium hover:text-primary truncate">
                    {s.problem?.title}
                  </Link>
                  {s.problem && <DifficultyBadge difficulty={s.problem.difficulty} className="hidden sm:inline-flex" />}
                </div>
                <div className="col-span-6 sm:col-span-2 flex items-center"><StatusBadge status={s.status} /></div>
                <div className="col-span-2 sm:col-span-1 flex items-center text-xs text-muted-foreground font-mono">{s.language}</div>
                <div className="col-span-2 sm:col-span-1 flex items-center justify-end text-xs text-muted-foreground tabular-nums">
                  {s.runtimeMs ?? 0}ms
                </div>
                <div className="col-span-2 sm:col-span-1 flex items-center justify-end text-xs text-muted-foreground tabular-nums">
                  {s.memoryKb ? `${(s.memoryKb / 1024).toFixed(1)}MB` : "—"}
                </div>
                <div className="col-span-12 sm:col-span-2 flex items-center sm:justify-end text-xs text-muted-foreground" title={formatDateTime(s.createdAt)}>
                  {timeAgo(s.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
