import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, MemoryStick } from "lucide-react";
import type { Submission } from "~/lib/types";

type PerTestResult = NonNullable<Submission["perTestResults"]>[number];

interface StdioPerTestResultsProps {
  perTestResults: PerTestResult[];
  /** Sample test cases from the problem, used to show expected output for diffs. */
  sampleTestCases?: Array<{ stdin: string; expected_stdout: string; name?: string }>;
}

/** Verdict color classes keyed by verdict string. */
function verdictColor(verdict: string): string {
  switch (verdict) {
    case "ACCEPTED":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    case "WRONG_ANSWER":
      return "text-rose-400 bg-rose-500/10 border-rose-500/20";
    case "TLE":
    case "TIME_LIMIT_EXCEEDED":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "MLE":
    case "MEMORY_LIMIT_EXCEEDED":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "OLE":
    case "OUTPUT_LIMIT_EXCEEDED":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "RE":
    case "RUNTIME_ERROR":
      return "text-rose-400 bg-rose-500/10 border-rose-500/20";
    case "COMPILE_ERROR":
      return "text-rose-400 bg-rose-500/10 border-rose-500/20";
    default:
      return "text-muted-foreground bg-muted/30 border-border";
  }
}

function verdictLabel(verdict: string): string {
  switch (verdict) {
    case "ACCEPTED": return "AC";
    case "WRONG_ANSWER": return "WA";
    case "TLE":
    case "TIME_LIMIT_EXCEEDED": return "TLE";
    case "MLE":
    case "MEMORY_LIMIT_EXCEEDED": return "MLE";
    case "OLE":
    case "OUTPUT_LIMIT_EXCEEDED": return "OLE";
    case "RE":
    case "RUNTIME_ERROR": return "RE";
    case "COMPILE_ERROR": return "CE";
    case "JUDGE_ERROR": return "JE";
    default: return verdict;
  }
}

/**
 * Simple line-by-line diff between actual and expected output.
 * Marks lines that differ with colored indicators. No external lib needed.
 */
function LineDiff({ actual, expected }: { actual: string; expected: string }) {
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");
  const maxLen = Math.max(actualLines.length, expectedLines.length);

  return (
    <div className="rounded-md border border-border bg-muted/20 overflow-hidden text-xs font-mono">
      <div className="grid grid-cols-2 border-b border-border bg-muted/40">
        <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground border-r border-border">
          Expected
        </div>
        <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          Actual
        </div>
      </div>
      <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
        {Array.from({ length: maxLen }, (_, i) => {
          const expLine = expectedLines[i] ?? "";
          const actLine = actualLines[i] ?? "";
          const differs = expLine !== actLine;
          return (
            <div
              key={i}
              className={`grid grid-cols-2 ${differs ? "bg-rose-500/5" : ""}`}
            >
              <div className={`px-3 py-0.5 border-r border-border whitespace-pre-wrap break-all ${differs ? "text-emerald-400" : "text-muted-foreground"}`}>
                <span className="inline-block w-5 text-right mr-2 text-muted-foreground/50 select-none">{i + 1}</span>
                {expLine || <span className="text-muted-foreground/30 italic">∅</span>}
              </div>
              <div className={`px-3 py-0.5 whitespace-pre-wrap break-all ${differs ? "text-rose-400" : "text-muted-foreground"}`}>
                <span className="inline-block w-5 text-right mr-2 text-muted-foreground/50 select-none">{i + 1}</span>
                {actLine || <span className="text-muted-foreground/30 italic">∅</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Per-test results renderer for STDIO submissions.
 *
 * - Ordered list of per-test verdicts with time/memory badges.
 * - SAMPLE failure cards expand to show Actual Output + line diff vs Expected Stdout.
 * - HIDDEN cases show verdict + metrics only. Never render stdin / expected_stdout / actual_output.
 */
export function StdioPerTestResults({ perTestResults, sampleTestCases }: StdioPerTestResultsProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggleExpand(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // Build a map of sample test case index -> sample array index for expected output lookup
  let sampleIdx = 0;
  const sampleMap = new Map<number, number>();
  for (const r of perTestResults) {
    if (r.visibility === "SAMPLE") {
      sampleMap.set(r.index, sampleIdx);
      sampleIdx++;
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        Per-Test Results
      </div>
      <ol className="space-y-1.5">
        {perTestResults.map((r) => {
          const isSample = r.visibility === "SAMPLE";
          const isFailed = r.verdict !== "ACCEPTED";
          const canExpand = isSample && isFailed && !!r.actual_output;
          const isExpanded = expanded.has(r.index);

          // Find expected output for this sample case
          const sampleCaseIdx = sampleMap.get(r.index);
          const expectedOutput =
            sampleCaseIdx != null && sampleTestCases?.[sampleCaseIdx]
              ? sampleTestCases[sampleCaseIdx].expected_stdout
              : undefined;

          return (
            <li key={r.index}>
              <div
                className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 ${
                  canExpand ? "cursor-pointer hover:bg-muted/30" : ""
                } ${isExpanded ? "bg-muted/20" : "bg-card"}`}
                onClick={canExpand ? () => toggleExpand(r.index) : undefined}
                role={canExpand ? "button" : undefined}
                aria-expanded={canExpand ? isExpanded : undefined}
              >
                {/* Expand indicator for expandable items */}
                {canExpand ? (
                  isExpanded ? (
                    <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                  )
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}

                {/* Test case number */}
                <span className="text-xs font-medium text-muted-foreground w-6 tabular-nums">
                  #{r.index + 1}
                </span>

                {/* Verdict badge */}
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium ${verdictColor(r.verdict)}`}
                >
                  {verdictLabel(r.verdict)}
                </span>

                {/* Visibility label */}
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    isSample
                      ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  {r.visibility}
                </span>

                {/* Time and memory badges */}
                <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {r.time_ms}ms
                  </span>
                  <span className="flex items-center gap-1">
                    <MemoryStick className="size-3" />
                    {r.memory_mb.toFixed(1)}MB
                  </span>
                </span>
              </div>

              {/* Expanded failure card for SAMPLE cases */}
              {isExpanded && canExpand && r.actual_output && (
                <div className="mt-1.5 ml-6 space-y-3 rounded-lg border border-border bg-card p-3">
                  {/* Actual Output */}
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                      Actual Output
                    </div>
                    <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto scrollbar-thin">
                      {r.actual_output}
                    </pre>
                  </div>

                  {/* Line diff vs expected */}
                  {expectedOutput != null && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                        Diff (Expected vs Actual)
                      </div>
                      <LineDiff actual={r.actual_output} expected={expectedOutput} />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
