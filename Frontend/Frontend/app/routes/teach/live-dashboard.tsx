/**
 * Live Instructor Dashboard — real-time student × problem progress matrix.
 *
 * Polls `GET /api/courses/:slug/live` every 10 seconds and renders a
 * color-coded grid showing each student's status on each problem.
 * Designed for projector display at 1920×1080.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  Activity, ArrowLeft, CheckCircle2, AlertTriangle, Circle,
  RefreshCw, Users, BookOpen,
} from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { Loading, RoleGuard } from "~/lib/guards";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "~/components/ui/table";
import { Empty } from "~/components/common/Empty";
import type {
  CellStatus,
  ExamSummary,
  GroupSummary,
  LiveDashboardResponse,
} from "~/lib/teaching-types";

const POLL_INTERVAL = 10_000;

export default function LiveDashboardPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const examSlug = searchParams.get("examSlug") || "";
  const groupSlug = searchParams.get("groupSlug") || "";

  const [data, setData] = useState<LiveDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter options fetched from course detail
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch filter options (exams + groups for this course)
  useEffect(() => {
    if (!slug) return;
    api<ExamSummary[]>(`/courses/${slug}/exams`).then(setExams).catch(() => {});
    api<GroupSummary[]>(`/courses/${slug}/groups`).then(setGroups).catch(() => {});
  }, [slug]);

  const fetchData = useCallback(async () => {
    if (!slug) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    if (examSlug) params.set("examSlug", examSlug);
    if (groupSlug) params.set("groupSlug", groupSlug);
    const qs = params.toString();
    const url = `/courses/${slug}/live${qs ? `?${qs}` : ""}`;

    try {
      const res = await api<LiveDashboardResponse>(url);
      if (!controller.signal.aborted) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof ApiError ? e.message : "Could not load live data");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [slug, examSlug, groupSlug]);

  // Initial fetch + polling
  useEffect(() => {
    setLoading(true);
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => {
      timerRef.current && clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  function refresh() {
    timerRef.current && clearInterval(timerRef.current);
    fetchData();
    timerRef.current = setInterval(fetchData, POLL_INTERVAL);
  }

  function setFilter(key: "examSlug" | "groupSlug", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  if (loading && !data) return <Loading />;
  if (error && !data) {
    return (
      <Empty
        icon={Activity}
        title="Could not load live dashboard"
        description={error}
        action={
          <Button asChild>
            <Link to={`/teach/courses/${slug}`}>
              <ArrowLeft className="size-4 mr-1.5" />Back to course
            </Link>
          </Button>
        }
      />
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
            <Link to={`/teach/courses/${slug}`}><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight truncate">
                {data.course.title}
              </h1>
              <Badge variant="secondary" className="gap-1">
                <Activity className="size-3" /> Live
              </Badge>
              {data.exam && (
                <Badge variant="outline">{data.exam.title}</Badge>
              )}
              {data.group && (
                <Badge variant="outline">
                  <Users className="size-3 mr-0.5" />{data.group.title}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Summary counts */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <span className="text-muted-foreground">
          <Users className="size-4 inline mr-1" />{data.summary.totalStudents} students
        </span>
        <span className="text-emerald-600 font-medium">
          <CheckCircle2 className="size-4 inline mr-1" />{data.summary.solved} solved
        </span>
        <span className="text-amber-600 font-medium">
          <Circle className="size-4 inline mr-1" />{data.summary.attempting} attempting
        </span>
        <span className="text-rose-600 font-medium">
          <AlertTriangle className="size-4 inline mr-1" />{data.summary.stuck} stuck
        </span>
        <span className="text-muted-foreground">
          {data.summary.idle} idle
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={examSlug || "__all__"} onValueChange={(v) => setFilter("examSlug", v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All problems" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All problems</SelectItem>
            {exams.map((e) => (
              <SelectItem key={e.slug} value={e.slug}>{e.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={groupSlug || "__all__"} onValueChange={(v) => setFilter("groupSlug", v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All groups</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.slug} value={g.slug}>{g.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Matrix */}
      {data.students.length === 0 || data.problems.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="No data to display"
          description="No students or problems match the current filters."
        />
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-background min-w-[180px]">
                  Student
                </TableHead>
                {data.problems.map((p) => (
                  <TableHead key={p.slug} className="text-center min-w-[80px] text-xs">
                    <span className="truncate block max-w-[100px]" title={p.title}>
                      {p.title}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((student) => (
                <TableRow key={student.id}>
                  <TableCell className="sticky left-0 z-10 bg-background font-medium whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="text-sm">
                        {student.fullName || student.username}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {student.groupSlug}
                      </span>
                    </div>
                  </TableCell>
                  {data.problems.map((problem) => {
                    const key = `${student.id}:${problem.slug}`;
                    const cell = data.matrix[key];
                    const status: CellStatus = cell?.status ?? "IDLE";
                    return (
                      <TableCell key={key} className="text-center p-1">
                        <StatusCell status={status} attempts={cell?.attempts ?? 0} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function StatusCell({ status, attempts }: { status: CellStatus; attempts: number }) {
  const base = "inline-flex items-center justify-center rounded-md size-8 text-xs font-medium";

  switch (status) {
    case "SOLVED":
      return (
        <span className={`${base} bg-emerald-500/20 text-emerald-600`} title="Solved">
          ✓
        </span>
      );
    case "ATTEMPTING":
      return (
        <span className={`${base} bg-amber-500/20 text-amber-600 animate-pulse`} title="Attempting">
          {attempts || "·"}
        </span>
      );
    case "STUCK":
      return (
        <span className={`${base} bg-rose-500/20 text-rose-600`} title="Stuck">
          !
        </span>
      );
    case "IDLE":
    default:
      return (
        <span className={`${base} bg-muted text-muted-foreground`} title="Idle">
          –
        </span>
      );
  }
}
