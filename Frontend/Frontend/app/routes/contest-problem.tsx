/**
 * Contest problem workspace (`/contests/:slug/problems/:letter`).
 *
 * Single-problem editor for a contest entry. Layout mirrors the exam
 * workspace:
 *
 *   - Top bar: back link, contest title, letter strip (navigate between
 *     problems without bouncing back to the detail page), countdown
 *     timer driven by `participation.personalDeadline`, Submit button.
 *   - Left pane: problem statement + samples + limits.
 *   - Right pane: Monaco-lite editor + language selector + Run
 *     (STDIO only) + result/submission history.
 *
 * Submit flow (tasks.md §21.1, Requirements 12.2–12.4):
 *   - `POST /api/contests/:slug/submissions/:letter` with `{ code, language }`
 *     + `Idempotency-Key: <uuid>` header (mirrors problem-detail).
 *   - Backend returns 202 `{ id, status: 'PENDING', letter,
 *     problem: { slug, title } }`. We then poll
 *     `GET /api/submissions/:id` every 600 ms until the verdict leaves
 *     PENDING (mirrors problem-detail).
 *
 * Submission history for THIS problem within the contest is maintained
 * locally — the backend has no dedicated "my contest submissions for
 * letter X" endpoint, and adding one is out of scope for this task.
 * Each new submission is prepended; the polled verdict update patches
 * the same id in place.
 *
 * Language allowlist for STDIO problems is read from
 * `problem.languageAllowlist`; for non-STDIO problems we fall back to
 * the per-type default set (`languagesFor`) used by `problem-detail.tsx`
 * and `exam.tsx`.
 *
 * Navigation (letter strip): switching problems navigates to the
 * sibling route `/contests/:slug/problems/:newLetter`, which triggers
 * a re-fetch of the problem detail and resets per-letter state
 * (code / stdin / result / local submission list).
 *
 * Edge cases:
 *   - Contest upcoming   → problem statements are hidden by the
 *     backend; we redirect back to the detail page with a toast.
 *   - Not participating  → Submit is disabled with a hint.
 *   - Deadline expired   → Submit is disabled and the countdown
 *     reads "Time expired".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft, Clock, MemoryStick, Play, RotateCcw, Send, Terminal, Timer,
} from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { Loading, ProtectedRoute } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "~/components/ui/resizable";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { StdioPerTestResults } from "~/components/stdio/StdioPerTestResults";
import { statusLabel, timeAgo } from "~/lib/format";
import type { ContestDetail, ContestProblemRef } from "~/lib/teaching-types";
import type { ProblemDetail, Submission } from "~/lib/types";

/* ─── language helpers (shared structure with problem-detail / exam) ─── */

const ALGO_LANGS = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python",     label: "Python" },
  { value: "java",       label: "Java" },
  { value: "go",         label: "Go" },
  { value: "cpp",        label: "C++" },
];
const CODE_LANGS = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python",     label: "Python" },
  { value: "java",       label: "Java" },
  { value: "go",         label: "Go" },
];
const SQL_LANGS = [{ value: "sql", label: "SQL" }];

const STDIO_LANG_MAP: Record<string, { value: string; label: string }> = {
  JAVASCRIPT: { value: "javascript", label: "JavaScript" },
  PYTHON:     { value: "python",     label: "Python" },
  JAVA:       { value: "java",       label: "Java" },
  GO:         { value: "go",         label: "Go" },
  CPP:        { value: "cpp",        label: "C++" },
};

function languagesFor(problem: ProblemDetail): { value: string; label: string }[] {
  if (problem.problemType === "STDIO" && problem.languageAllowlist?.length) {
    return problem.languageAllowlist
      .map((l) => STDIO_LANG_MAP[l.toUpperCase()])
      .filter(Boolean);
  }
  if (problem.problemType === "SQL") return SQL_LANGS;
  if (problem.problemType === "BACKEND" || problem.problemType === "FRONTEND") return CODE_LANGS;
  return ALGO_LANGS;
}

function defaultTemplate(language: string, problem: ProblemDetail): string {
  if (problem.problemType === "STDIO") return stdioTemplate(language);
  const fn = problem.functionName || "solution";
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

/** Response shape from `POST /api/submissions/:slug/run` for STDIO problems. */
interface StdioRunResult {
  stdout: string;
  stderr: string;
  verdict: string;
  timeMs: number;
  memoryMb: number;
  timedOut: boolean;
}

/** Contest submit response (202) — subset of `Submission`. */
interface ContestSubmitResponse {
  id: number;
  status: Submission["status"];
  letter: string;
  problem: { slug: string; title: string };
}

/* ─── route entry ──────────────────────────────────────────────────────── */

export default function ContestProblemPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const { slug = "", letter: rawLetter = "" } = useParams<{ slug: string; letter: string }>();
  const letter = rawLetter.toUpperCase();
  const navigate = useNavigate();

  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [contestError, setContestError] = useState<string | null>(null);

  // Load contest detail (letters + participation). Re-fetch on slug change.
  const loadContest = useCallback(async () => {
    try {
      setContest(await api<ContestDetail>(`/contests/${slug}`));
    } catch (e) {
      setContestError(e instanceof ApiError ? e.message : "Could not load contest");
    }
  }, [slug]);

  useEffect(() => { loadContest(); }, [loadContest]);

  // Problem letter uppercase normalisation — canonical form for URLs.
  useEffect(() => {
    if (rawLetter && rawLetter !== letter) {
      navigate(`/contests/${slug}/problems/${letter}`, { replace: true });
    }
  }, [rawLetter, letter, slug, navigate]);

  if (contestError) {
    return (
      <div className="p-6">
        <Empty
          title="Could not load contest"
          description={contestError}
          action={
            <Button asChild>
              <Link to="/contests"><ArrowLeft className="size-4 mr-1.5" />Back to contests</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (!contest) return <Loading />;

  // Problem statements are only available during/after the contest.
  // If the contest is upcoming, kick the user back to the detail page
  // rather than render an empty workspace.
  if (contest.status === "upcoming") {
    // Fire-and-forget navigate in render; we still show a Loading fallback.
    setTimeout(() => {
      toast.info("Problems open once the contest starts");
      navigate(`/contests/${slug}`, { replace: true });
    }, 0);
    return <Loading />;
  }

  const current = contest.problems.find((p) => p.letter === letter);
  if (!current || !current.slug) {
    return (
      <div className="p-6">
        <Empty
          title={`Problem "${letter}" not found in this contest`}
          action={
            <Button asChild>
              <Link to={`/contests/${slug}`}>
                <ArrowLeft className="size-4 mr-1.5" />Back to contest
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <Workspace
      contest={contest}
      current={current as ContestProblemRef & { slug: string }}
      letter={letter}
      onReloadContest={loadContest}
    />
  );
}

/* ─── active workspace ─────────────────────────────────────────────────── */

function Workspace({
  contest, current, letter, onReloadContest,
}: {
  contest: ContestDetail;
  current: ContestProblemRef & { slug: string };
  letter: string;
  onReloadContest: () => Promise<void>;
}) {
  const slug = contest.slug;

  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  // STDIO state
  const [stdin, setStdin] = useState("");
  const [stdioRunResult, setStdioRunResult] = useState<StdioRunResult | null>(null);

  const pollAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { pollAbortRef.current?.abort(); }, []);

  // Reset per-letter UI state whenever we switch problems.
  useEffect(() => {
    setResult(null);
    setStdioRunResult(null);
    setSubmissions([]);
    setProblem(null);
    setProblemError(null);
  }, [letter]);

  // Load problem detail from the shared public endpoint.
  useEffect(() => {
    let cancelled = false;
    api<ProblemDetail>(`/problems/${current.slug}`)
      .then((p) => {
        if (cancelled) return;
        setProblem(p);
        const langs = languagesFor(p);
        const defaultLang = langs[0]?.value || "javascript";
        setLanguage(defaultLang);
        const key = codeKey(slug, letter, defaultLang);
        const saved = typeof window !== "undefined" ? localStorage.getItem(key) : null;
        setCode(saved || p.starterCode?.[defaultLang] || defaultTemplate(defaultLang, p));
        if (p.problemType === "STDIO" && p.sampleTestCases?.length) {
          setStdin(p.sampleTestCases[0].stdin);
        } else {
          setStdin("");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setProblemError(e instanceof ApiError ? e.message : "Could not load problem");
      });
    return () => { cancelled = true; };
  }, [current.slug, slug, letter]);

  // Persist code per (contest, letter, language).
  useEffect(() => {
    if (!problem || !language) return;
    try {
      localStorage.setItem(codeKey(slug, letter, language), code);
    } catch {}
  }, [code, language, slug, letter, problem]);

  function onLanguageChange(v: string) {
    setLanguage(v);
    if (!problem) return;
    const key = codeKey(slug, letter, v);
    const saved = typeof window !== "undefined" ? localStorage.getItem(key) : null;
    setCode(saved || problem.starterCode?.[v] || defaultTemplate(v, problem));
  }

  function resetCode() {
    if (!problem) return;
    setCode(problem.starterCode?.[language] || defaultTemplate(language, problem));
    toast.success("Reset to starter code");
  }

  /** Poll `GET /api/submissions/:id` until the status leaves PENDING. */
  async function pollSubmission(id: number, signal: AbortSignal): Promise<Submission> {
    const MAX_ATTEMPTS = 60; // ~36 s
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, 600));
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const sub = await api<Submission>(`/submissions/${id}`);
      if (sub.status !== "PENDING") return sub;
    }
    throw new Error("Judging timed out — check back later");
  }

  async function runCode() {
    if (!problem) return;
    setRunning(true);
    setStdioRunResult(null);
    try {
      if (problem.problemType === "STDIO") {
        const res = await api<StdioRunResult>(`/submissions/${current.slug}/run`, {
          body: { language, code, stdin },
        });
        setStdioRunResult(res);
      } else {
        const res = await api<any>(`/submissions/${current.slug}/run`, {
          body: { language, code },
        });
        setResult({
          id: 0,
          status: res.status,
          language,
          runtimeMs: res.runtimeMs,
          memoryKb: res.memoryKb,
          testsPassed: res.testsPassed,
          testsTotal: res.testsTotal,
          output: res.output,
          error: res.error,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function submit() {
    if (!problem) return;
    pollAbortRef.current?.abort();
    pollAbortRef.current = new AbortController();
    const signal = pollAbortRef.current.signal;

    setSubmitting(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await api<ContestSubmitResponse>(
        `/contests/${slug}/submissions/${letter}`,
        {
          body: { code, language },
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );

      // Backend returns a subset; widen to Submission for local list.
      const initial: Submission = {
        id: res.id,
        status: res.status,
        language,
        createdAt: new Date().toISOString(),
      };
      setResult(initial);
      setSubmissions((s) => [initial, ...s].slice(0, 20));

      let final: Submission = initial;
      if (res.status === "PENDING") {
        final = await pollSubmission(res.id, signal);
        setResult(final);
        setSubmissions((s) => s.map((x) => (x.id === final.id ? final : x)));
      }

      if (final.status === "ACCEPTED") toast.success("Accepted!");
      else toast.error(statusLabel(final.status));

      // Refresh contest detail so participation / status stay in sync.
      onReloadContest().catch(() => {});
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof ApiError ? e.message : (e as Error).message || "Submit failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const participation = contest.participation;
  const deadlineMs = participation ? new Date(participation.personalDeadline).getTime() : 0;
  const canSubmit = !!participation && Date.now() < deadlineMs && !submitting && !running;
  const submitDisabledReason = !participation
    ? "Start participation on the contest page to submit"
    : Date.now() >= deadlineMs
      ? "Your contest time has expired"
      : "";

  const isStdio = problem?.problemType === "STDIO";

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border bg-card/60 backdrop-blur px-4 h-12 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
          <Link to={`/contests/${slug}`}>
            <ArrowLeft className="size-4 mr-1" /> Contest
          </Link>
        </Button>
        <span className="text-muted-foreground">|</span>
        <h1 className="font-semibold truncate text-sm">{contest.title}</h1>

        <LetterStrip
          problems={contest.problems}
          slug={slug}
          activeLetter={letter}
        />

        <div className="ml-auto flex items-center gap-3">
          {participation && <Countdown deadline={participation.personalDeadline} />}

          {isStdio && (
            <Button
              variant="outline"
              size="sm"
              onClick={runCode}
              disabled={running || submitting || !problem}
            >
              <Play className="size-3.5 mr-1.5" />
              {running ? "Running…" : "Run"}
            </Button>
          )}

          <Button
            size="sm"
            onClick={submit}
            disabled={!canSubmit || !problem}
            title={submitDisabledReason || undefined}
            className="gradient-bg text-white border-0"
          >
            <Send className="size-3.5 mr-1.5" />
            {submitting ? "Judging…" : "Submit"}
          </Button>
        </div>
      </div>

      {/* Workspace */}
      {problemError ? (
        <div className="p-6">
          <Empty title="Could not load this problem" description={problemError} />
        </div>
      ) : !problem ? (
        <div className="flex-1"><Loading /></div>
      ) : isStdio ? (
        <StdioBody
          problem={problem}
          current={current}
          letter={letter}
          language={language}
          onLanguageChange={onLanguageChange}
          code={code}
          setCode={setCode}
          stdin={stdin}
          setStdin={setStdin}
          stdioRunResult={stdioRunResult}
          result={result}
          running={running}
          submitting={submitting}
          submissions={submissions}
          resetCode={resetCode}
        />
      ) : (
        <RegularBody
          problem={problem}
          current={current}
          letter={letter}
          language={language}
          onLanguageChange={onLanguageChange}
          code={code}
          setCode={setCode}
          result={result}
          submitting={submitting}
          submissions={submissions}
          resetCode={resetCode}
        />
      )}
    </div>
  );
}

/* ─── letter strip ──────────────────────────────────────────────────────── */

function LetterStrip({
  problems, slug, activeLetter,
}: {
  problems: ContestProblemRef[];
  slug: string;
  activeLetter: string;
}) {
  return (
    <div className="flex items-center gap-1 ml-2">
      {problems.map((p) => {
        const active = p.letter === activeLetter;
        return (
          <Link
            key={p.letter}
            to={`/contests/${slug}/problems/${p.letter}`}
            title={p.title}
            className={`
              px-2.5 py-1 rounded-md text-xs font-semibold tabular-nums transition-colors
              ${active
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"}
            `}
          >
            {p.letter}
          </Link>
        );
      })}
    </div>
  );
}

/* ─── countdown ─────────────────────────────────────────────────────────── */

function Countdown({ deadline }: { deadline: string }) {
  const end = useMemo(() => new Date(deadline).getTime(), [deadline]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(end - now, 0);
  const total = Math.ceil(remainingMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const urgent = total <= 300;
  const expired = remainingMs === 0;

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-mono tabular-nums ${
      expired
        ? "bg-muted text-muted-foreground"
        : urgent
          ? "bg-rose-500/10 text-rose-500"
          : "bg-muted text-muted-foreground"
    }`}>
      <Timer className="size-3.5" />
      {expired
        ? "Time expired"
        : h > 0
          ? `${pad(h)}:${pad(m)}:${pad(s)}`
          : `${m}:${pad(s)}`}
    </div>
  );
}

/* ─── non-STDIO body ────────────────────────────────────────────────────── */

function RegularBody({
  problem, current, letter, language, onLanguageChange, code, setCode,
  result, submitting, submissions, resetCode,
}: {
  problem: ProblemDetail;
  current: ContestProblemRef & { slug: string };
  letter: string;
  language: string;
  onLanguageChange: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  result: Submission | null;
  submitting: boolean;
  submissions: Submission[];
  resetCode: () => void;
}) {
  return (
    <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
      <ResizablePanel defaultSize={42} minSize={25} className="bg-card/40">
        <div className="h-full overflow-y-auto scrollbar-thin">
          <DescriptionPane problem={problem} current={current} letter={letter} />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle className="bg-border" />

      <ResizablePanel defaultSize={58} minSize={30}>
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={62} minSize={20}>
            <div className="h-full flex flex-col bg-card">
              <EditorToolbar
                problem={problem}
                language={language}
                onLanguageChange={onLanguageChange}
                codeLines={code.split("\n").length}
                resetCode={resetCode}
              />
              <CodeMirrorLite value={code} onChange={setCode} />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border" />

          <ResizablePanel defaultSize={38} minSize={15} className="bg-card/40">
            <div className="h-full overflow-y-auto scrollbar-thin p-4 space-y-4">
              <ResultView result={result} running={submitting} />
              <SubmissionHistory submissions={submissions} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/* ─── STDIO body ────────────────────────────────────────────────────────── */

function StdioBody({
  problem, current, letter, language, onLanguageChange, code, setCode,
  stdin, setStdin, stdioRunResult, result, running, submitting,
  submissions, resetCode,
}: {
  problem: ProblemDetail;
  current: ContestProblemRef & { slug: string };
  letter: string;
  language: string;
  onLanguageChange: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  stdin: string;
  setStdin: (v: string) => void;
  stdioRunResult: StdioRunResult | null;
  result: Submission | null;
  running: boolean;
  submitting: boolean;
  submissions: Submission[];
  resetCode: () => void;
}) {
  return (
    <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
      <ResizablePanel defaultSize={40} minSize={25} className="bg-card/40">
        <div className="h-full overflow-y-auto scrollbar-thin">
          <DescriptionPane problem={problem} current={current} letter={letter} />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle className="bg-border" />

      <ResizablePanel defaultSize={60} minSize={30}>
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={55} minSize={20}>
            <div className="h-full flex flex-col bg-card">
              <EditorToolbar
                problem={problem}
                language={language}
                onLanguageChange={onLanguageChange}
                codeLines={code.split("\n").length}
                resetCode={resetCode}
                fullProgram
              />
              <CodeMirrorLite value={code} onChange={setCode} />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border" />

          <ResizablePanel defaultSize={45} minSize={15} className="bg-card/40">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={40} minSize={20}>
                <div className="h-full flex flex-col">
                  <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center gap-2">
                    <Terminal className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">stdin</span>
                  </div>
                  <textarea
                    value={stdin}
                    onChange={(e) => setStdin(e.target.value)}
                    placeholder="Enter input here..."
                    spellCheck={false}
                    className="flex-1 w-full p-3 bg-card text-foreground font-mono text-[13px] leading-relaxed resize-none focus:outline-none scrollbar-thin"
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle className="bg-border" />

              <ResizablePanel defaultSize={60} minSize={20}>
                <div className="h-full flex flex-col">
                  <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center gap-2">
                    <Terminal className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Output</span>
                    {stdioRunResult && (
                      <StdioVerdictBadge
                        verdict={stdioRunResult.verdict}
                        timedOut={stdioRunResult.timedOut}
                      />
                    )}
                    {stdioRunResult && (
                      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                        {stdioRunResult.timeMs}ms · {stdioRunResult.memoryMb.toFixed(1)}MB
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-4">
                    {running && !stdioRunResult && (
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
                      <p className="text-sm text-muted-foreground">
                        Run or submit your code to see output here.
                      </p>
                    )}
                    {!running && stdioRunResult && (
                      <div className="space-y-3">
                        {stdioRunResult.stdout && (
                          <LabeledPre label="stdout" body={stdioRunResult.stdout} />
                        )}
                        {stdioRunResult.stderr && (
                          <LabeledPre label="stderr" body={stdioRunResult.stderr} error />
                        )}
                        {!stdioRunResult.stdout && !stdioRunResult.stderr && (
                          <p className="text-sm text-muted-foreground italic">No output produced.</p>
                        )}
                      </div>
                    )}
                    {result && (
                      <div className="space-y-4">
                        <ResultView result={result} running={submitting} />
                        {result.perTestResults && result.perTestResults.length > 0 && (
                          <StdioPerTestResults
                            perTestResults={result.perTestResults}
                            sampleTestCases={problem.sampleTestCases}
                          />
                        )}
                      </div>
                    )}
                    <SubmissionHistory submissions={submissions} />
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/* ─── editor toolbar ────────────────────────────────────────────────────── */

function EditorToolbar({
  problem, language, onLanguageChange, codeLines, resetCode, fullProgram,
}: {
  problem: ProblemDetail;
  language: string;
  onLanguageChange: (v: string) => void;
  codeLines: number;
  resetCode: () => void;
  fullProgram?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
      <Select value={language} onValueChange={onLanguageChange}>
        <SelectTrigger className="w-[150px] h-8 border-border bg-background text-foreground text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {languagesFor(problem).map((l) => (
            <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {fullProgram && (
        <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          Full Program
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground"
        onClick={resetCode}
      >
        <RotateCcw className="size-3.5 mr-1.5" /> Reset
      </Button>
      <span className="ml-auto text-xs text-muted-foreground font-mono">
        {codeLines} lines
      </span>
    </div>
  );
}

/* ─── description pane ──────────────────────────────────────────────────── */

function DescriptionPane({
  problem, current, letter,
}: {
  problem: ProblemDetail;
  current: ContestProblemRef & { slug: string };
  letter: string;
}) {
  return (
    <article className="p-6 space-y-5">
      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-semibold">
            {letter}
          </span>
          <h1 className="text-xl font-bold m-0 truncate">{current.title || problem.title}</h1>
          {problem.difficulty && <DifficultyBadge difficulty={problem.difficulty} />}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Stat icon={Clock} label="Time"   value={`${problem.timeLimitMs}ms`} />
          <Stat icon={MemoryStick} label="Memory" value={`${problem.memoryLimitMb}MB`} />
        </div>
      </header>

      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ParagraphRenderer content={problem.description} />
      </div>

      {problem.problemType === "STDIO" &&
        problem.sampleTestCases &&
        problem.sampleTestCases.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Sample Test Cases</h3>
            {problem.sampleTestCases.map((tc, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs font-semibold mb-2">{tc.name || `Sample ${i + 1}`}</div>
                <div className="space-y-2 text-sm font-mono">
                  <KV k="Input" v={tc.stdin} />
                  <KV k="Expected Output" v={tc.expected_stdout} />
                </div>
              </div>
            ))}
          </section>
        )}

      {problem.problemType !== "STDIO" && problem.examples.length > 0 && (
        <section className="space-y-3">
          {problem.examples.map((ex, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs font-semibold mb-2">Example {i + 1}</div>
              <div className="space-y-2 text-sm font-mono">
                <KV k="Input"  v={ex.input} />
                <KV k="Output" v={ex.output} />
                {ex.explanation && <KV k="Note" v={ex.explanation} mono={false} />}
              </div>
            </div>
          ))}
        </section>
      )}

      {problem.constraints && (
        <section>
          <h3 className="font-semibold mb-2 text-sm">Constraints</h3>
          <pre className="rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono leading-relaxed">
            {problem.constraints}
          </pre>
        </section>
      )}
    </article>
  );
}

/* ─── result + history + shared bits ────────────────────────────────────── */

function ResultView({ result, running }: { result: Submission | null; running: boolean }) {
  if (running && (!result || result.status === "PENDING")) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
        Judging your code…
      </div>
    );
  }
  if (!result) {
    return <p className="text-sm text-muted-foreground">Submit to see results here.</p>;
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
            <Tile label="Runtime" value={`${result.runtimeMs} ms`} icon={Clock} />
          )}
          {result.memoryKb != null && (
            <Tile label="Memory" value={`${(result.memoryKb / 1024).toFixed(1)} MB`} icon={MemoryStick} />
          )}
        </div>
      )}
      {result.error && (
        <LabeledPre label="Error" body={result.error} error />
      )}
    </div>
  );
}

function SubmissionHistory({ submissions }: { submissions: Submission[] }) {
  if (submissions.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Your submissions
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {submissions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <StatusBadge status={s.status} />
            <span className="text-xs text-muted-foreground">{s.language}</span>
            {s.runtimeMs != null && (
              <span className="text-xs text-muted-foreground tabular-nums">{s.runtimeMs}ms</span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{timeAgo(s.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StdioVerdictBadge({ verdict, timedOut }: { verdict: string; timedOut: boolean }) {
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

function LabeledPre({ label, body, error }: { label: string; body: string; error?: boolean }) {
  return (
    <div>
      <div className={`text-[11px] uppercase tracking-wider mb-1 ${error ? "text-rose-400" : "text-muted-foreground"}`}>
        {label}
      </div>
      <pre className={`rounded-md border p-3 text-xs font-mono whitespace-pre-wrap ${
        error ? "border-rose-500/30 bg-rose-500/5" : "border-border bg-muted/30"
      }`}>
        {body}
      </pre>
    </div>
  );
}

function Tile({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function KV({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-2">{k}</span>
      <span className={mono ? "font-mono whitespace-pre-wrap" : "whitespace-pre-wrap font-sans"}>{v}</span>
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

/* ─── tiny editor (textarea with tab indent) ────────────────────────────── */

function CodeMirrorLite({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = ref.current; if (!el) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = value.substring(0, start) + "  " + value.substring(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      className="flex-1 w-full p-4 bg-card text-foreground font-mono text-[13px] leading-relaxed resize-none focus:outline-none scrollbar-thin"
      style={{ tabSize: 2 }}
    />
  );
}

/* ─── local helpers ─────────────────────────────────────────────────────── */

function codeKey(slug: string, letter: string, language: string) {
  return `skillforge.contest.${slug}.${letter}.${language}`;
}
