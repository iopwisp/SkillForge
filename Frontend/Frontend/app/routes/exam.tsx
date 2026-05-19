import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft, Send, Play, Timer, Clock, AlertTriangle, CheckCircle2, Lock,
  RotateCcw, MemoryStick, Flag, Terminal,
} from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import type { ExamDetail, ExamProblemRef, ExamAttempt } from "~/lib/teaching-types";
import type { Submission, ProblemDetail } from "~/lib/types";
import { StdioPerTestResults } from "~/components/stdio/StdioPerTestResults";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { Button } from "~/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import {
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
} from "~/components/ui/resizable";
import { formatDateTime, statusLabel } from "~/lib/format";

/* ─── language helpers (shared with problem-detail) ─────────────────────── */

const CODE_LANGS = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
];
const SQL_LANGS = [{ value: "sql", label: "SQL" }];
const ALGO_LANGS = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "cpp", label: "C++" },
];

/** Maps backend language allowlist values to display labels (STDIO). */
const STDIO_LANG_MAP: Record<string, { value: string; label: string }> = {
  JAVASCRIPT: { value: "javascript", label: "JavaScript" },
  PYTHON:     { value: "python",     label: "Python" },
  JAVA:       { value: "java",       label: "Java" },
  GO:         { value: "go",         label: "Go" },
  CPP:        { value: "cpp",        label: "C++" },
};

function langsForType(t?: string) {
  if (t === "SQL") return SQL_LANGS;
  if (t === "BACKEND" || t === "FRONTEND") return CODE_LANGS;
  return ALGO_LANGS;
}

/** Returns the language list for a problem, respecting STDIO allowlist. */
function langsForProblem(problem: ProblemDetail | null): { value: string; label: string }[] {
  if (!problem) return ALGO_LANGS;
  if (problem.problemType === "STDIO" && problem.languageAllowlist?.length) {
    return problem.languageAllowlist
      .map(l => STDIO_LANG_MAP[l.toUpperCase()])
      .filter(Boolean);
  }
  return langsForType(problem.problemType);
}

function defaultTemplate(language: string, problem?: ProblemDetail | null): string {
  // STDIO problems get full-program templates (no function harness)
  if (problem?.problemType === "STDIO") {
    return stdioTemplate(language);
  }
  const fn = problem?.functionName || "solution";
  const templates: Record<string, string> = {
    javascript: `// Write your solution here\nfunction ${fn}(...args) {\n  \n}\n`,
    typescript: `// Write your solution here\nfunction ${fn}(...args: any[]): any {\n  \n}\n`,
    python: `# Write your solution here\ndef ${fn}(*args):\n    pass\n`,
    java: `import java.util.*;\n\nclass Solution {\n    public Object ${fn}(Object... args) {\n        return null;\n    }\n}\n`,
    go: `package main\n\nfunc ${fn}(args ...any) any {\n    return nil\n}\n`,
    cpp: `// Write your solution here\nclass Solution {\npublic:\n    void ${fn}() {\n        \n    }\n};\n`,
    sql: "-- Your SQL here\n",
  };
  return templates[language] || "";
}

function stdioTemplate(language: string): string {
  const templates: Record<string, string> = {
    javascript: `const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nconst lines = [];\nrl.on('line', (line) => lines.push(line));\nrl.on('close', () => {\n  // Your solution here\n  \n});\n`,
    python: `import sys\n\ndef main():\n    # Your solution here\n    input_data = sys.stdin.read().split()\n    \n\nif __name__ == '__main__':\n    main()\n`,
    java: `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // Your solution here\n        \n    }\n}\n`,
    go: `package main\n\nimport (\n    "bufio"\n    "fmt"\n    "os"\n)\n\nfunc main() {\n    reader := bufio.NewReader(os.Stdin)\n    _ = reader\n    // Your solution here\n    fmt.Println()\n}\n`,
    cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Your solution here\n    \n    return 0;\n}\n`,
  };
  return templates[language] || `// Write your solution here\n`;
}

/** Response shape from POST /api/submissions/:slug/run for STDIO problems. */
interface StdioRunResult {
  stdout: string;
  stderr: string;
  verdict: string;
  timeMs: number;
  memoryMb: number;
  timedOut: boolean;
}

/* ─── main page ──────────────────────────────────────────────────────────── */

export default function ExamPage() {
  return (
    <ProtectedRoute>
      <ExamContent />
    </ProtectedRoute>
  );
}

type ExamPhase = "loading" | "lobby" | "active" | "finished";

function ExamContent() {
  const { slug: courseSlug = "", examSlug = "" } = useParams();
  const navigate = useNavigate();

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [phase, setPhase] = useState<ExamPhase>("loading");
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Load exam detail + check for existing attempt
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ex, att] = await Promise.allSettled([
          api<ExamDetail>(`/courses/${courseSlug}/exams/${examSlug}`),
          api<ExamAttempt>(`/courses/${courseSlug}/exams/${examSlug}/attempts/me`),
        ]);
        if (cancelled) return;
        if (ex.status === "rejected") {
          toast.error("Exam not found");
          navigate(`/courses/${courseSlug}`, { replace: true });
          return;
        }
        const examData = ex.value;
        setExam(examData);

        if (att.status === "fulfilled") {
          const a = att.value;
          setAttempt(a);
          setPhase(a.finishedAt || a.timeLeftMs <= 0 ? "finished" : "active");
        } else {
          setPhase("lobby");
        }
      } catch {
        toast.error("Failed to load exam");
      }
    })();
    return () => { cancelled = true; };
  }, [courseSlug, examSlug, navigate]);

  async function handleStart() {
    setStarting(true);
    try {
      const a = await api<ExamAttempt>(
        `/courses/${courseSlug}/exams/${examSlug}/attempts`,
        { method: "POST" },
      );
      setAttempt(a);
      setPhase("active");
      toast.success("Exam started!");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start exam");
    } finally {
      setStarting(false);
    }
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      const a = await api<ExamAttempt>(
        `/courses/${courseSlug}/exams/${examSlug}/attempts/current/finish`,
        { method: "POST" },
      );
      setAttempt(a);
      setPhase("finished");
      toast.success("Exam finished!");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not finish exam");
    } finally {
      setFinishing(false);
    }
  }

  function onTimerExpire() {
    setPhase("finished");
    // Re-fetch to get final score
    api<ExamAttempt>(`/courses/${courseSlug}/exams/${examSlug}/attempts/me`)
      .then(setAttempt)
      .catch(() => {});
  }

  if (phase === "loading" || !exam) return <div className="h-[60vh]"><Loading /></div>;

  if (phase === "lobby") {
    return <ExamLobby exam={exam} courseSlug={courseSlug} onStart={handleStart} starting={starting} />;
  }

  if (phase === "finished") {
    return <ExamResults exam={exam} attempt={attempt} courseSlug={courseSlug} />;
  }

  // Active attempt
  return (
    <ExamWorkspace
      exam={exam}
      attempt={attempt!}
      courseSlug={courseSlug}
      onFinish={handleFinish}
      finishing={finishing}
      onTimerExpire={onTimerExpire}
      onAttemptUpdate={setAttempt}
    />
  );
}

/* ─── Lobby (before start) ──────────────────────────────────────────────── */

function ExamLobby({
  exam, courseSlug, onStart, starting,
}: {
  exam: ExamDetail; courseSlug: string; onStart: () => void; starting: boolean;
}) {
  const now = Date.now();
  const notYet = now < new Date(exam.startsAt).getTime();
  const closed = now >= new Date(exam.endsAt).getTime();
  const canStart = !notYet && !closed;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
        <Link to={`/courses/${courseSlug}`}><ArrowLeft className="size-4 mr-1" /> Back to course</Link>
      </Button>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <h1 className="text-2xl font-bold">{exam.title}</h1>
        {exam.description && (
          <p className="text-sm text-muted-foreground">{exam.description}</p>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoTile icon={Clock} label="Window" value={`${formatDateTime(exam.startsAt)} — ${formatDateTime(exam.endsAt)}`} />
          <InfoTile icon={Timer} label="Duration" value={`${exam.durationMinutes} minutes`} />
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Problems ({exam.problems.length})</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {exam.problems.map((p, i) => (
              <li key={p.slug} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                <span className="flex-1 font-medium">{p.title}</span>
                <DifficultyBadge difficulty={p.difficulty} />
                <span className="text-xs text-muted-foreground">{p.points} pts</span>
              </li>
            ))}
          </ul>
        </div>

        {notYet && (
          <div className="flex items-center gap-2 text-sm text-blue-500 bg-blue-500/10 rounded-lg p-3">
            <Lock className="size-4" /> This exam hasn't started yet. Opens {formatDateTime(exam.startsAt)}.
          </div>
        )}
        {closed && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg p-3">
            <AlertTriangle className="size-4" /> This exam window has closed.
          </div>
        )}
        {canStart && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="lg" className="w-full gradient-bg text-white border-0" disabled={starting}>
                <Play className="size-4 mr-2" />
                {starting ? "Starting..." : "Start Exam"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start exam?</AlertDialogTitle>
                <AlertDialogDescription>
                  You have {exam.durationMinutes} minutes once you start. You can only start once.
                  Your timer begins immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onStart}>Start now</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

/* ─── Results (after finish/expiry) ─────────────────────────────────────── */

function ExamResults({
  exam, attempt, courseSlug,
}: {
  exam: ExamDetail; attempt: ExamAttempt | null; courseSlug: string;
}) {
  const score = attempt?.score;
  const pct = score && score.total > 0 ? Math.round((score.earned / score.total) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
        <Link to={`/courses/${courseSlug}`}><ArrowLeft className="size-4 mr-1" /> Back to course</Link>
      </Button>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{exam.title}</h1>
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-muted text-muted-foreground">
            Finished
          </span>
        </div>

        {score && (
          <div className="grid grid-cols-3 gap-4">
            <ScoreTile label="Score" value={`${score.earned} / ${score.total}`} sub={`${pct}%`} accent />
            <ScoreTile label="Problems Solved" value={`${score.solved} / ${score.outOf}`} />
            <ScoreTile
              label="Duration"
              value={attempt?.startedAt && attempt?.finishedAt
                ? formatDuration(new Date(attempt.startedAt), new Date(attempt.finishedAt))
                : "—"}
            />
          </div>
        )}

        {attempt && attempt.submissions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Submissions</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {attempt.submissions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <StatusBadge status={s.status} />
                  <span className="flex-1 font-medium">{s.problem.title}</span>
                  <DifficultyBadge difficulty={s.problem.difficulty} />
                  <span className="text-xs text-muted-foreground">{s.language}</span>
                  {s.testsPassed != null && s.testsTotal != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.testsPassed}/{s.testsTotal}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Active workspace ──────────────────────────────────────────────────── */

function ExamWorkspace({
  exam, attempt, courseSlug, onFinish, finishing, onTimerExpire, onAttemptUpdate,
}: {
  exam: ExamDetail;
  attempt: ExamAttempt;
  courseSlug: string;
  onFinish: () => void;
  finishing: boolean;
  onTimerExpire: () => void;
  onAttemptUpdate: (a: ExamAttempt) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const problems = exam.problems;
  const current = problems[selectedIdx];

  // Problem detail (loaded lazily per problem)
  const [problemDetail, setProblemDetail] = useState<ProblemDetail | null>(null);
  const [language, setLanguage] = useState<string>("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);

  // STDIO-specific state
  const [stdin, setStdin] = useState<string>("");
  const [stdioRunResult, setStdioRunResult] = useState<StdioRunResult | null>(null);

  const pollAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { pollAbortRef.current?.abort(); }, []);

  // Load problem detail when switching problems
  useEffect(() => {
    if (!current) return;
    setProblemDetail(null);
    setResult(null);
    setStdioRunResult(null);
    api<ProblemDetail>(`/problems/${current.slug}`)
      .then((p) => {
        setProblemDetail(p);
        const langs = langsForProblem(p);
        const defaultLang = langs[0]?.value || "javascript";
        setLanguage(defaultLang);
        // Restore code from localStorage or use starter
        const key = `skillforge.exam.${exam.slug}.${current.slug}.${defaultLang}`;
        const saved = localStorage.getItem(key);
        setCode(saved || p.starterCode?.[defaultLang] || defaultTemplate(defaultLang, p));
        // Pre-populate stdin with first sample test case for STDIO problems
        if (p.problemType === "STDIO" && p.sampleTestCases?.length) {
          setStdin(p.sampleTestCases[0].stdin);
        } else {
          setStdin("");
        }
      })
      .catch(() => toast.error("Failed to load problem"));
  }, [current?.slug, exam.slug]);

  // Persist code to localStorage on change
  useEffect(() => {
    if (!current || !language || !code) return;
    const key = `skillforge.exam.${exam.slug}.${current.slug}.${language}`;
    try { localStorage.setItem(key, code); } catch {}
  }, [code, current?.slug, language, exam.slug]);

  // Track which problems are solved based on attempt submissions
  const solvedSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const s of attempt.submissions) {
      if (s.status === "ACCEPTED") set.add(s.problem.slug);
    }
    return set;
  }, [attempt.submissions]);

  async function pollSubmission(id: number, signal: AbortSignal): Promise<Submission> {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 600));
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const sub = await api<Submission>(`/submissions/${id}`);
      if (sub.status !== "PENDING") return sub;
    }
    throw new Error("Judging timed out");
  }

  async function handleRun() {
    if (!current || !problemDetail) return;
    setRunning(true);
    setStdioRunResult(null);
    try {
      const res = await api<StdioRunResult>(`/submissions/${current.slug}/run`, {
        body: { language, code, stdin },
      });
      setStdioRunResult(res);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleSubmit() {
    if (!current) return;
    pollAbortRef.current?.abort();
    pollAbortRef.current = new AbortController();
    const signal = pollAbortRef.current.signal;

    setSubmitting(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await api<Submission>(
        `/courses/${courseSlug}/exams/${exam.slug}/attempts/current/submissions/${current.slug}`,
        {
          body: { language, code },
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );

      setResult(res);

      let final = res;
      if (res.status === "PENDING") {
        final = await pollSubmission(res.id, signal);
        setResult(final);
      }

      if (final.status === "ACCEPTED") {
        toast.success("Accepted!");
      } else {
        toast.error(statusLabel(final.status));
      }

      // Refresh attempt to update score + submissions list
      api<ExamAttempt>(`/courses/${courseSlug}/exams/${exam.slug}/attempts/me`)
        .then(onAttemptUpdate)
        .catch(() => {});
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(e instanceof ApiError ? e.message : (e as Error).message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  function resetCode() {
    if (!problemDetail || !current) return;
    const starter = problemDetail.starterCode?.[language] || defaultTemplate(language, problemDetail);
    setCode(starter);
    toast.success("Reset to starter code");
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Exam top bar */}
      <div className="border-b border-border/60 bg-background px-4 h-14 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 h-8">
          <Link to={`/courses/${courseSlug}`}><ArrowLeft className="size-4 mr-1" /> Course</Link>
        </Button>
        <span className="text-muted-foreground">|</span>
        <h1 className="font-semibold truncate text-sm">{exam.title}</h1>

        {/* Problem pills */}
        <div className="flex items-center gap-1 ml-4">
          {problems.map((p, i) => {
            const solved = solvedSlugs.has(p.slug);
            const active = i === selectedIdx;
            return (
              <button
                key={p.slug}
                onClick={() => setSelectedIdx(i)}
                className={`
                  px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                  ${active
                    ? "bg-primary text-primary-foreground"
                    : solved
                      ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                      : "bg-muted text-muted-foreground hover:bg-accent"}
                `}
                title={p.title}
              >
                {i + 1}{solved ? " \u2713" : ""}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <CountdownTimer initialMs={attempt.timeLeftMs} onExpire={onTimerExpire} />

          <span className="text-xs text-muted-foreground tabular-nums">
            {attempt.score.solved}/{attempt.score.outOf} solved
          </span>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={finishing}>
                <Flag className="size-3.5 mr-1.5" />
                {finishing ? "Finishing..." : "Finish Exam"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Finish exam?</AlertDialogTitle>
                <AlertDialogDescription>
                  You cannot submit any more answers after finishing. Your current score
                  is {attempt.score.earned}/{attempt.score.total} ({attempt.score.solved}/{attempt.score.outOf} solved).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep working</AlertDialogCancel>
                <AlertDialogAction onClick={onFinish}>Finish now</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Workspace */}
      {!current || !problemDetail ? (
        <div className="flex-1"><Loading /></div>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          {/* Left: problem description */}
          <ResizablePanel defaultSize={40} minSize={25} className="bg-background">
            <div className="h-full overflow-y-auto p-6 space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">{current.title}</h2>
                <DifficultyBadge difficulty={current.difficulty} />
                <span className="text-xs text-muted-foreground ml-auto">{current.points} pts</span>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ParagraphRenderer content={problemDetail.description} />
              </div>
              {problemDetail.examples.length > 0 && (
                <div className="space-y-3 not-prose">
                  {problemDetail.examples.map((ex, i) => (
                    <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="text-xs font-semibold mb-2">Example {i + 1}</div>
                      <div className="space-y-1 text-sm font-mono">
                        <div><span className="text-[11px] uppercase text-muted-foreground mr-2">Input</span>{ex.input}</div>
                        <div><span className="text-[11px] uppercase text-muted-foreground mr-2">Output</span>{ex.output}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* STDIO sample test cases */}
              {problemDetail.problemType === "STDIO" && problemDetail.sampleTestCases && problemDetail.sampleTestCases.length > 0 && (
                <div className="space-y-3 not-prose">
                  <h3 className="text-sm font-semibold">Sample Test Cases</h3>
                  {problemDetail.sampleTestCases.map((tc, i) => (
                    <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="text-xs font-semibold mb-2">{tc.name || `Sample ${i + 1}`}</div>
                      <div className="space-y-1 text-sm font-mono">
                        <div><span className="text-[11px] uppercase text-muted-foreground mr-2">Input</span><pre className="inline whitespace-pre-wrap">{tc.stdin}</pre></div>
                        <div><span className="text-[11px] uppercase text-muted-foreground mr-2">Output</span><pre className="inline whitespace-pre-wrap">{tc.expected_stdout}</pre></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {problemDetail.constraints && (
                <pre className="rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono">{problemDetail.constraints}</pre>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border/60 w-px" />

          {/* Right: editor + result — branched for STDIO */}
          <ResizablePanel defaultSize={60} minSize={30}>
            {problemDetail.problemType === "STDIO" ? (
              <ExamStdioPanel
                exam={exam}
                current={current}
                problemDetail={problemDetail}
                language={language}
                setLanguage={(v) => {
                  setLanguage(v);
                  const key = `skillforge.exam.${exam.slug}.${current.slug}.${v}`;
                  const saved = localStorage.getItem(key);
                  setCode(saved || problemDetail.starterCode?.[v] || defaultTemplate(v, problemDetail));
                }}
                code={code}
                setCode={setCode}
                stdin={stdin}
                setStdin={setStdin}
                stdioRunResult={stdioRunResult}
                result={result}
                running={running}
                submitting={submitting}
                onRun={handleRun}
                onSubmit={handleSubmit}
                resetCode={resetCode}
              />
            ) : (
            <ResizablePanelGroup direction="vertical">
              {/* Editor */}
              <ResizablePanel defaultSize={65} minSize={20}>
                <div className="h-full flex flex-col bg-background">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-transparent">
                    <Select value={language} onValueChange={(v) => {
                      setLanguage(v);
                      const key = `skillforge.exam.${exam.slug}.${current.slug}.${v}`;
                      const saved = localStorage.getItem(key);
                      setCode(saved || problemDetail.starterCode?.[v] || defaultTemplate(v, problemDetail));
                    }}>
                      <SelectTrigger className="w-[140px] h-8 border-border/60 bg-background text-foreground text-xs shadow-sm focus:ring-1 focus:ring-primary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {langsForProblem(problemDetail).map(l => (
                          <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground" onClick={resetCode}>
                      <RotateCcw className="size-3.5 mr-1.5" /> Reset
                    </Button>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="h-8 shadow-sm"
                      >
                        <Send className="size-3.5 mr-1.5" />
                        {submitting ? "Judging..." : "Submit"}
                      </Button>
                    </div>
                  </div>
                  <textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                    className="flex-1 w-full p-4 bg-transparent text-foreground font-mono text-[13px] leading-relaxed resize-none outline-none scrollbar-thin"
                    style={{ tabSize: 2 }}
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle className="bg-border/60 h-px" />

              {/* Result */}
              <ResizablePanel defaultSize={35} minSize={15} className="bg-background">
                <div className="h-full overflow-y-auto p-4">
                  <ExamResultView result={result} submitting={submitting} />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

/* ─── Countdown timer ────────────────────────────────────────────────────── */

function CountdownTimer({ initialMs, onExpire }: { initialMs: number; onExpire: () => void }) {
  const [remaining, setRemaining] = useState(Math.max(0, initialMs));
  const expiredRef = useRef(false);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, initialMs - elapsed);
      setRemaining(left);
      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        clearInterval(interval);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [initialMs, onExpire]);

  const total = Math.ceil(remaining / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const urgent = total <= 300; // last 5 minutes

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-mono tabular-nums ${
      urgent ? "bg-rose-500/10 text-rose-500" : "bg-muted text-muted-foreground"
    }`}>
      <Timer className="size-3.5" />
      {h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
             : `${m}:${String(s).padStart(2, "0")}`}
    </div>
  );
}

/* ─── STDIO panel for exam workspace ─────────────────────────────────────── */

function ExamStdioPanel({
  exam, current, problemDetail, language, setLanguage, code, setCode,
  stdin, setStdin, stdioRunResult, result, running, submitting,
  onRun, onSubmit, resetCode,
}: {
  exam: ExamDetail;
  current: ExamProblemRef;
  problemDetail: ProblemDetail;
  language: string;
  setLanguage: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  stdin: string;
  setStdin: (v: string) => void;
  stdioRunResult: StdioRunResult | null;
  result: Submission | null;
  running: boolean;
  submitting: boolean;
  onRun: () => void;
  onSubmit: () => void;
  resetCode: () => void;
}) {
  return (
    <ResizablePanelGroup direction="vertical">
      {/* Editor */}
      <ResizablePanel defaultSize={50} minSize={20}>
        <div className="h-full flex flex-col bg-background">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-transparent">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[140px] h-8 border-border/60 bg-background text-foreground text-xs shadow-sm focus:ring-1 focus:ring-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {langsForProblem(problemDetail).map(l => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Full Program
            </span>
            <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground" onClick={resetCode}>
              <RotateCcw className="size-3.5 mr-1.5" /> Reset
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onRun} disabled={running || submitting} className="h-8 border-border/60 shadow-sm">
                <Play className="size-3.5 mr-1.5" />
                {running ? "Running..." : "Run"}
              </Button>
              <Button
                size="sm"
                onClick={onSubmit}
                disabled={running || submitting}
                className="h-8 shadow-sm"
              >
                <Send className="size-3.5 mr-1.5" />
                {submitting ? "Judging..." : "Submit"}
              </Button>
            </div>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1 w-full p-4 bg-transparent text-foreground font-mono text-[13px] leading-relaxed resize-none outline-none scrollbar-thin"
            style={{ tabSize: 2 }}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle className="bg-border/60 h-px" />

      {/* Stdin / Stdout + Results */}
      <ResizablePanel defaultSize={50} minSize={15} className="bg-background">
        <ResizablePanelGroup direction="horizontal">
          {/* Stdin */}
          <ResizablePanel defaultSize={40} minSize={20}>
            <div className="h-full flex flex-col">
              <div className="px-3 py-2 border-b border-border/60 bg-transparent flex items-center gap-2">
                <Terminal className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">stdin</span>
              </div>
              <textarea
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="Enter input here..."
                spellCheck={false}
                className="flex-1 w-full p-3 bg-transparent text-foreground font-mono text-[13px] leading-relaxed resize-none outline-none scrollbar-thin"
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border/60 w-px" />

          {/* Stdout / Result */}
          <ResizablePanel defaultSize={60} minSize={20}>
            <div className="h-full flex flex-col border-l border-border/60">
              <div className="px-3 py-2 border-b border-border/60 bg-transparent flex items-center gap-2">
                <Terminal className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Output</span>
                {stdioRunResult && (
                  <ExamStdioVerdictBadge verdict={stdioRunResult.verdict} timedOut={stdioRunResult.timedOut} />
                )}
                {stdioRunResult && (
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {stdioRunResult.timeMs}ms · {stdioRunResult.memoryMb.toFixed(1)}MB
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
                {running && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                    Running…
                  </div>
                )}
                {submitting && !result && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                    Judging…
                  </div>
                )}
                {!running && !submitting && !stdioRunResult && !result && (
                  <p className="text-sm text-muted-foreground">Run or submit your code to see output here.</p>
                )}
                {!running && stdioRunResult && (
                  <div className="space-y-3">
                    {stdioRunResult.stdout && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">stdout</div>
                        <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{stdioRunResult.stdout}</pre>
                      </div>
                    )}
                    {stdioRunResult.stderr && (
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-rose-400 mb-1">stderr</div>
                        <pre className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs font-mono whitespace-pre-wrap">{stdioRunResult.stderr}</pre>
                      </div>
                    )}
                    {!stdioRunResult.stdout && !stdioRunResult.stderr && (
                      <p className="text-sm text-muted-foreground italic">No output produced.</p>
                    )}
                  </div>
                )}
                {!running && !stdioRunResult && result && (
                  <div className="space-y-4">
                    <ExamResultView result={result} submitting={submitting} />
                    {result.perTestResults && result.perTestResults.length > 0 && (
                      <StdioPerTestResults
                        perTestResults={result.perTestResults}
                        sampleTestCases={problemDetail.sampleTestCases}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function ExamStdioVerdictBadge({ verdict, timedOut }: { verdict: string; timedOut: boolean }) {
  const color = verdict === "ACCEPTED"
    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : timedOut
      ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
      : "text-rose-400 bg-rose-500/10 border-rose-500/20";
  const label = verdict === "ACCEPTED" ? "AC"
    : verdict === "TLE" || timedOut ? "TLE"
    : verdict === "MLE" ? "MLE"
    : verdict === "OLE" ? "OLE"
    : verdict === "RE" || verdict === "RUNTIME_ERROR" ? "RE"
    : verdict === "COMPILE_ERROR" ? "CE"
    : verdict === "WRONG_ANSWER" ? "WA"
    : verdict;
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${color}`}>
      {label}
    </span>
  );
}

/* ─── Result view (same structure as problem-detail) ─────────────────────── */

function ExamResultView({ result, submitting }: { result: Submission | null; submitting: boolean }) {
  if (submitting && (!result || result.status === "PENDING")) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
        Judging your code...
      </div>
    );
  }
  if (!result) {
    return <p className="text-sm text-muted-foreground">Submit your code to see results here.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={result.status} />
        {result.testsTotal != null && (
          <span className="text-xs text-muted-foreground">
            {result.testsPassed}/{result.testsTotal} tests passed
          </span>
        )}
      </div>
      {(result.runtimeMs != null || result.memoryKb != null) && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          {result.runtimeMs != null && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="size-3.5" /> Runtime</div>
              <div className="mt-1 font-semibold tabular-nums">{result.runtimeMs} ms</div>
            </div>
          )}
          {result.memoryKb != null && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><MemoryStick className="size-3.5" /> Memory</div>
              <div className="mt-1 font-semibold tabular-nums">{((result.memoryKb || 0) / 1024).toFixed(1)} MB</div>
            </div>
          )}
        </div>
      )}
      {result.error && (
        <div>
          <div className="text-xs text-rose-400 mb-1">Error</div>
          <pre className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs font-mono whitespace-pre-wrap">{result.error}</pre>
        </div>
      )}
    </div>
  );
}

/* ─── Small helpers ──────────────────────────────────────────────────────── */

function InfoTile({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" /> {label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function ScoreTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function ParagraphRenderer({ content }: { content: string }) {
  const paragraphs = content.split(/\n\s*\n/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="mb-4 last:mb-0 whitespace-pre-line">{p}</p>
      ))}
    </>
  );
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${s}s`;
}
