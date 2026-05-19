/**
 * Gradebook panel for the course detail page.
 *
 * Renders the read model returned by `GET /api/courses/:slug/gradebook`
 * (per ADR 0010): students × exams matrix, with `null` cells for exams
 * that don't apply to a given student (group-scoped exam vs unrelated
 * group). Totals on the right are the sum of *applicable* exams only.
 *
 * The "Download CSV" button hits the same backend handler that emits the
 * server-formatted CSV (`username,full_name,groups,<exam-slugs>,total`).
 * We use fetch directly (not `api()`) so we can stream the body to a
 * Blob URL and trigger a browser download.
 */
import { useEffect, useState } from "react";
import { Download, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, API_URL } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/common/Empty";
import type { Gradebook } from "~/lib/teaching-types";

export function GradebookPanel({ courseSlug }: { courseSlug: string }) {
  const [data, setData] = useState<Gradebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<Gradebook>(`/courses/${courseSlug}/gradebook`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load gradebook"))
      .finally(() => setLoading(false));
  }, [courseSlug]);

  async function downloadCsv() {
    setDownloading(true);
    try {
      const res = await fetch(`${API_URL}/courses/${courseSlug}/gradebook.csv`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${courseSlug}-gradebook.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch (e) {
      toast.error(`Could not download CSV: ${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <div className="h-72 rounded-xl border border-border bg-card animate-pulse" />;
  if (error) return <Empty icon={Trophy} title="Gradebook unavailable" description={error} />;
  if (!data) return null;

  const { exams, rows } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span>
            {rows.length} student{rows.length === 1 ? "" : "s"} ·
            {" "}{exams.length} exam{exams.length === 1 ? "" : "s"}
          </span>
        </div>
        <Button onClick={downloadCsv} disabled={downloading || rows.length === 0}>
          <Download className="size-4 mr-1.5" />
          {downloading ? "Preparing…" : "Download CSV"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty
          icon={Users}
          title="No students enrolled"
          description="Add a group with members to see them appear here."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Student</th>
                <th className="px-4 py-2.5 text-left font-medium">Groups</th>
                {exams.map(exam => (
                  <th
                    key={exam.slug}
                    className="px-4 py-2.5 text-center font-medium whitespace-nowrap"
                    title={`${exam.title} · ${exam.totalPoints} pts${exam.groupSlug ? ` · group ${exam.groupSlug}` : ""}`}
                  >
                    <div className="flex flex-col items-center">
                      <code className="text-[11px]">{exam.slug}</code>
                      <span className="text-[10px] normal-case text-muted-foreground/70">
                        {exam.totalPoints} pts
                      </span>
                    </div>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(row => (
                <tr key={row.student.id} className="hover:bg-accent/30">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{row.student.fullName || row.student.username}</div>
                    <code className="text-[11px] text-muted-foreground">{row.student.username}</code>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {row.groups.length === 0 ? <span className="opacity-60">—</span> :
                      row.groups.map(g => (
                        <span key={g.slug} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-muted">
                          {g.slug}
                        </span>
                      ))}
                  </td>
                  {row.scores.map(score => (
                    <td key={score.examSlug} className="px-4 py-2.5 text-center text-xs tabular-nums">
                      {!score.applicable ? (
                        <span className="text-muted-foreground/40">N/A</span>
                      ) : score.score ? (
                        <span className={score.attempted ? "" : "text-muted-foreground"}>
                          {score.score.earned}/{score.score.total}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {row.total.earned}<span className="text-muted-foreground">/{row.total.total}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
