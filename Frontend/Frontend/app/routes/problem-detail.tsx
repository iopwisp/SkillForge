import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Play, Send, ArrowLeft, BookOpen, Lightbulb, Star, Clock, MemoryStick, History,
  ChevronRight, RotateCcw, Database,
} from "lucide-react";
import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import type { ProblemDetail, Submission } from "~/lib/types";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { StatusBadge } from "~/components/common/StatusBadge";
import { Loading } from "~/lib/guards";
import { Button } from "~/components/ui/button";
import {
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
} from "~/components/ui/resizable";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { ApiError } from "~/lib/api";
import { timeAgo, statusLabel } from "~/lib/format";

/** Language menus differ per problem type so students can't pick a language
 *  the judge can't actually run for that kind of task. */
const ALGO_LANGS = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python",     label: "Python" },
  { value: "java",       label: "Java" },
  { value: "cpp",        label: "C++" },
];
const JS_ONLY_LANGS = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
];
const SQL_LANGS = [{ value: "sql", label: "SQL" }];

function languagesFor(problem: ProblemDetail) {
  if (problem.problemType === "SQL") return SQL_LANGS;
  if (problem.problemType === "BACKEND" || problem.problemType === "FRONTEND") return JS_ONLY_LANGS;
  return ALGO_LANGS;
}

function defaultLanguage(problem: ProblemDetail) {
  return languagesFor(problem)[0]?.value || "javascript";
}

const DEFAULT_TEMPLATE: Record<string, string> = {
  javascript: `// Write your solution here\nvar solution = function() {\n    \n};\n`,
  typescript: `// Write your solution here\nfunction solution() {\n    \n}\n`,
  python:     `# Write your solution here\nclass Solution:\n    def solve(self):\n        pass\n`,
  java:       `// Write your solution here\nclass Solution {\n    public void solve() {\n        \n    }\n}\n`,
  cpp:        `// Write your solution here\nclass Solution {\npublic:\n    void solve() {\n        \n    }\n};\n`,
  sql:        `-- Your SQL here\nSELECT * FROM ...;\n`,
};

export default function ProblemDetailPage() {
  const { slug = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [language, setLanguage] = useState<string>("javascript");
  const [code, setCode] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [tab, setTab] = useState<"description" | "schema" | "submissions" | "hints">("description");
  const [resultTab, setResultTab] = useState<"testcase" | "result">("testcase");

  const codeStorageKey = useMemo(() => `skillforge.code.${slug}.${language}`, [slug, language]);

  // Load problem
  useEffect(() => {
    setProblem(null);
    api<ProblemDetail>(`/problems/${slug}`).then((p) => {
      setProblem(p);
      // Force the right starting language for non-algorithm problems.
      const langs = languagesFor(p);
      if (!langs.some(l => l.value === language)) {
        setLanguage(defaultLanguage(p));
      }
    })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) navigate("/404", { replace: true });
        else toast.error("Failed to load problem");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, navigate]);

  // Load submissions
  useEffect(() => {
    if (!user) { setSubmissions([]); return; }
    api<Submission[]>(`/submissions/problem/${slug}`).then(setSubmissions).catch(() => {});
  }, [slug, user]);

  // Initialise code per (slug, language)
  useEffect(() => {
    if (!problem) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem(codeStorageKey) : null;
    if (saved) {
      setCode(saved);
    } else {
      const starter = problem.starterCode?.[language] ?? DEFAULT_TEMPLATE[language] ?? "";
      setCode(starter);
    }
  }, [problem, language, codeStorageKey]);

  // Persist code
  useEffect(() => {
    if (!problem || code === undefined) return;
    try { localStorage.setItem(codeStorageKey, code); } catch {}
  }, [code, codeStorageKey, problem]);

  function resetCode() {
    if (!problem) return;
    const starter = problem.starterCode?.[language] ?? DEFAULT_TEMPLATE[language] ?? "";
    setCode(starter);
    toast.success("Reset to starter code");
  }

  async function runCode() {
    if (!user) return toast.error("Sign in to run your code");
    setRunning(true);
    setResultTab("result");
    try {
      const res = await api<any>(`/submissions/${slug}/run`, { body: { language, code } });
      setResult({
        id: 0, status: res.status, language, code,
        runtimeMs: res.runtimeMs, memoryKb: res.memoryKb,
        testsPassed: res.testsPassed, testsTotal: res.testsTotal,
        output: res.output, error: res.error,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function submit() {
    if (!user) return toast.error("Sign in to submit");
    setSubmitting(true);
    setResultTab("result");
    try {
      const res = await api<Submission>(`/submissions/${slug}`, { body: { language, code } });
      setResult(res);
      setSubmissions(s => [res, ...s]);
      if (res.status === "ACCEPTED") {
        toast.success("Accepted! 🎉");
        // refresh problem to update solved badge
        api<ProblemDetail>(`/problems/${slug}`).then(setProblem).catch(() => {});
      } else {
        toast.error(statusLabel(res.status));
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleFavorite() {
    if (!user || !problem) return toast.error("Sign in to save favourites");
    const prev = problem.favorited;
    setProblem({ ...problem, favorited: !prev });
    try {
      await api(`/problems/${problem.slug}/favorite`, { method: "POST" });
    } catch {
      setProblem({ ...problem, favorited: prev });
    }
  }

  if (!problem) return <div className="h-[80vh]"><Loading /></div>;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Subtle top bar */}
      <div className="border-b border-border bg-card/60 backdrop-blur px-4 h-12 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
          <Link to="/problems"><ArrowLeft className="size-4 mr-1" /> Problems</Link>
        </Button>
        <span className="text-muted-foreground">·</span>
        <h1 className="font-semibold truncate">{problem.title}</h1>
        <DifficultyBadge difficulty={problem.difficulty} />
        {problem.status === "solved" && <StatusBadge status="ACCEPTED" />}
        <button
          onClick={toggleFavorite}
          className={`ml-1 p-1.5 rounded-md hover:bg-accent ${problem.favorited ? "text-amber-500" : "text-muted-foreground"}`}
          aria-label="Toggle favourite"
        >
          <Star className={`size-4 ${problem.favorited ? "fill-current" : ""}`} />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={runCode} disabled={running || submitting}>
            <Play className="size-3.5 mr-1.5" />
            {running ? "Running…" : "Run"}
          </Button>
          <Button size="sm" onClick={submit} disabled={running || submitting} className="gradient-bg text-white border-0">
            <Send className="size-3.5 mr-1.5" />
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>

      {/* Workspace */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* LEFT: description / submissions */}
        <ResizablePanel defaultSize={42} minSize={28} className="bg-card/40">
          <div className="h-full flex flex-col">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="h-full flex flex-col">
              <div className="px-3 pt-2 border-b border-border">
                <TabsList className="bg-transparent p-0 gap-1">
                  <TabsTrigger value="description" className="data-[state=active]:bg-accent">
                    <BookOpen className="size-3.5 mr-1.5" /> Description
                  </TabsTrigger>
                  {problem.problemType === "SQL" && problem.sqlSetup && (
                    <TabsTrigger value="schema" className="data-[state=active]:bg-accent">
                      <Database className="size-3.5 mr-1.5" /> Schema
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="submissions" className="data-[state=active]:bg-accent">
                    <History className="size-3.5 mr-1.5" /> Submissions
                  </TabsTrigger>
                  <TabsTrigger value="hints" className="data-[state=active]:bg-accent">
                    <Lightbulb className="size-3.5 mr-1.5" /> Hints
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <TabsContent value="description" className="m-0 p-6 space-y-6">
                  <DescriptionView problem={problem} />
                </TabsContent>
                {problem.problemType === "SQL" && problem.sqlSetup && (
                  <TabsContent value="schema" className="m-0 p-6">
                    <SchemaView setup={problem.sqlSetup} />
                  </TabsContent>
                )}
                <TabsContent value="submissions" className="m-0 p-6">
                  <SubmissionsView submissions={submissions} />
                </TabsContent>
                <TabsContent value="hints" className="m-0 p-6">
                  <HintsView hints={problem.hints} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-border" />

        {/* RIGHT: editor + result */}
        <ResizablePanel defaultSize={58} minSize={30}>
          <ResizablePanelGroup direction="vertical">
            {/* Editor */}
            <ResizablePanel defaultSize={62} minSize={20}>
              <div className="h-full flex flex-col bg-zinc-950">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/60">
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="w-[150px] h-8 bg-zinc-900 border-zinc-800 text-zinc-200 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {languagesFor(problem).map(l => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {problem.functionName && (
                    <span className="text-xs text-zinc-500 font-mono ml-1 hidden md:inline" title="Required entry-point function">
                      fn: <span className="text-violet-400">{problem.functionName}</span>
                    </span>
                  )}
                  <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-zinc-100" onClick={resetCode}>
                    <RotateCcw className="size-3.5 mr-1.5" /> Reset
                  </Button>
                  <span className="ml-auto text-xs text-zinc-500 font-mono">
                    {code.split("\n").length} lines
                  </span>
                </div>
                <CodeMirrorLite value={code} onChange={setCode} />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle className="bg-border" />

            {/* Result panel */}
            <ResizablePanel defaultSize={38} minSize={15} className="bg-card/40">
              <div className="h-full flex flex-col">
                <Tabs value={resultTab} onValueChange={(v) => setResultTab(v as any)} className="h-full flex flex-col">
                  <div className="px-3 pt-2 border-b border-border">
                    <TabsList className="bg-transparent p-0 gap-1">
                      <TabsTrigger value="testcase" className="data-[state=active]:bg-accent">Examples</TabsTrigger>
                      <TabsTrigger value="result" className="data-[state=active]:bg-accent">Result</TabsTrigger>
                    </TabsList>
                  </div>
                  <div className="flex-1 overflow-y-auto scrollbar-thin">
                    <TabsContent value="testcase" className="m-0 p-4 space-y-3">
                      {problem.examples.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No examples for this problem.</p>
                      ) : problem.examples.map((ex, i) => (
                        <div key={i} className="rounded-lg border border-border bg-card p-3">
                          <div className="text-xs font-semibold text-muted-foreground mb-2">Example {i + 1}</div>
                          <div className="space-y-2 text-sm font-mono">
                            <KV k="Input"  v={ex.input} />
                            <KV k="Output" v={ex.output} />
                            {ex.explanation && <KV k="Note" v={ex.explanation} mono={false} />}
                          </div>
                        </div>
                      ))}
                    </TabsContent>
                    <TabsContent value="result" className="m-0 p-4">
                      <ResultView result={result} running={running || submitting} />
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  ALGORITHM: "Algorithm",
  SQL: "SQL",
  BACKEND: "Backend",
  FRONTEND: "Frontend",
};

function DescriptionView({ problem }: { problem: ProblemDetail }) {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <header className="not-prose mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold m-0">{problem.title}</h1>
          <DifficultyBadge difficulty={problem.difficulty} />
          {problem.problemType && problem.problemType !== "ALGORITHM" && (
            <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {TYPE_LABEL[problem.problemType] || problem.problemType}
            </span>
          )}
          {problem.category && (
            <Link to={`/problems?category=${problem.category.slug}`} className="text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-3 inline" /> {problem.category.name}
            </Link>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {problem.tags.map(t => <span key={t} className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>)}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Stat icon={Clock} label="Time"   value={`${problem.timeLimitMs}ms`} />
          <Stat icon={MemoryStick} label="Memory" value={`${problem.memoryLimitMb}MB`} />
          <Stat icon={History} label="AC rate" value={`${problem.acceptanceRate}%`} />
        </div>
      </header>

      <Markdown content={problem.description} />

      {problem.examples.length > 0 && (
        <div className="not-prose mt-6 space-y-3">
          {problem.examples.map((ex, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs font-semibold mb-2">Example {i + 1}</div>
              <div className="space-y-2 text-sm font-mono">
                <KV k="Input"  v={ex.input} />
                <KV k="Output" v={ex.output} />
                {ex.explanation && <KV k="Explanation" v={ex.explanation} mono={false} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {problem.constraints && (
        <div className="not-prose mt-6">
          <h3 className="font-semibold mb-2 text-sm">Constraints</h3>
          <pre className="rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono leading-relaxed">{problem.constraints}</pre>
        </div>
      )}
    </article>
  );
}

function HintsView({ hints }: { hints: string[] }) {
  const [revealed, setRevealed] = useState<number[]>([]);
  if (!hints || hints.length === 0) return <p className="text-sm text-muted-foreground">No hints available for this problem.</p>;
  return (
    <ul className="space-y-3">
      {hints.map((h, i) => {
        const open = revealed.includes(i);
        return (
          <li key={i} className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <button
              className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setRevealed(r => open ? r.filter(x => x !== i) : [...r, i])}
            >
              <Lightbulb className="size-3.5" /> Hint {i + 1} <span className="text-[10px]">{open ? "(hide)" : "(show)"}</span>
            </button>
            {open && <p className="mt-2">{h}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Renders the SQL DDL/DML that the judge runs before each test case so
 * students can browse the available tables and sample data.
 *
 * We split the script into individual CREATE/INSERT statements and group
 * them by table so the schema reads top-to-bottom like a data dictionary.
 */
function SchemaView({ setup }: { setup: string }) {
  const tables = useMemo(() => parseSqlSetup(setup), [setup]);
  return (
    <div className="space-y-5 text-sm">
      <p className="text-xs text-muted-foreground">
        Each test runs against a fresh in-memory SQLite seeded with the
        following schema and rows. Your query is read-only against this
        snapshot.
      </p>
      {tables.length === 0 && (
        <pre className="rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono">{setup}</pre>
      )}
      {tables.map((t) => (
        <div key={t.name} className="rounded-lg border border-border bg-muted/20 overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
            <Database className="size-3.5 text-violet-500" />
            <span className="font-mono text-sm font-semibold">{t.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {t.columns.length} cols · {t.rows.length} rows
            </span>
          </div>
          {t.columns.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted-foreground">
                    {t.columns.map((c, i) => (
                      <th key={i} className="text-left px-3 py-1.5 font-medium border-b border-border">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-1 truncate max-w-[200px]">{cell}</td>
                      ))}
                    </tr>
                  ))}
                  {t.rows.length > 10 && (
                    <tr>
                      <td colSpan={t.columns.length} className="px-3 py-1 text-muted-foreground italic">
                        … {t.rows.length - 10} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Pragmatic SQL setup parser — extracts table name, columns, and sample
 * rows from a CREATE TABLE + INSERT VALUES script. Not a full SQL parser:
 * we only parse the patterns we actually emit in the seed.
 */
function parseSqlSetup(setup: string): Array<{ name: string; columns: string[]; rows: string[][] }> {
  const tables: Record<string, { name: string; columns: string[]; rows: string[][] }> = {};
  const order: string[] = [];

  // CREATE TABLE name ( col1 type, col2 type, ... );
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(setup)) !== null) {
    const name = m[1];
    const body = m[2];
    const columns: string[] = [];
    // Naive column splitter: split on commas at the top level.
    let depth = 0;
    let buf = "";
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        const col = parseColumnDef(buf);
        if (col) columns.push(col);
        buf = "";
      } else buf += ch;
    }
    const tail = parseColumnDef(buf);
    if (tail) columns.push(tail);
    tables[name] = { name, columns, rows: [] };
    order.push(name);
  }

  // INSERT INTO name VALUES (..), (..);
  const insertRe = /INSERT\s+INTO\s+(\w+)(?:\s*\([^)]*\))?\s+VALUES\s*([\s\S]*?);/gi;
  while ((m = insertRe.exec(setup)) !== null) {
    const name = m[1];
    if (!tables[name]) continue;
    const valuesPart = m[2];
    for (const row of splitTopLevelTuples(valuesPart)) {
      tables[name].rows.push(splitTupleValues(row));
    }
  }
  return order.map((n) => tables[n]);
}

function parseColumnDef(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Skip table-level constraints like PRIMARY KEY (a, b)
  if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(s)) return null;
  return s.split(/\s+/)[0];
}

/** Splits a string like "(1,'a'),(2,'b')" into ["1,'a'", "2,'b'"]. */
function splitTopLevelTuples(s: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr = false, buf = "", start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      buf += ch;
      if (ch === "'" && s[i + 1] !== "'") inStr = false;
      continue;
    }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === "(") {
      if (depth === 0) { start = i + 1; buf = ""; }
      else buf += ch;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && start !== -1) { out.push(buf); buf = ""; }
      else buf += ch;
    } else if (depth > 0) buf += ch;
  }
  return out;
}

function splitTupleValues(s: string): string[] {
  const out: string[] = [];
  let inStr = false, buf = "", depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'" && s[i + 1] === "'") { buf += "'"; i++; continue; }
      if (ch === "'") { inStr = false; continue; }
      buf += ch;
      continue;
    }
    if (ch === "'") { inStr = true; continue; }
    if (ch === "(") { depth++; buf += ch; continue; }
    if (ch === ")") { depth--; buf += ch; continue; }
    if (ch === "," && depth === 0) { out.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function SubmissionsView({ submissions }: { submissions: Submission[] }) {
  const { user } = useAuth();
  if (!user) return <p className="text-sm text-muted-foreground">Sign in to view your submissions for this problem.</p>;
  if (submissions.length === 0) return <p className="text-sm text-muted-foreground">No submissions yet.</p>;
  return (
    <ul className="divide-y divide-border -my-2">
      {submissions.map(s => (
        <li key={s.id} className="py-3 flex items-center gap-3 text-sm">
          <StatusBadge status={s.status} />
          <span className="text-xs text-muted-foreground">{s.language}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{s.runtimeMs}ms</span>
          <span className="text-xs text-muted-foreground tabular-nums">{Math.round((s.memoryKb || 0) / 1024)}MB</span>
          <span className="ml-auto text-xs text-muted-foreground">{timeAgo(s.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function ResultView({ result, running }: { result: Submission | null; running: boolean }) {
  if (running) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
        Judging your code…
      </div>
    );
  }
  if (!result) {
    return <p className="text-sm text-muted-foreground">Run or submit your code to see results here.</p>;
  }
  const isAccepted = result.status === "ACCEPTED";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={result.status} />
        {result.testsTotal != null && (
          <span className="text-xs text-muted-foreground">
            {result.testsPassed}/{result.testsTotal} tests passed
          </span>
        )}
        {isAccepted && result.beats != null && (
          <span className="text-xs text-emerald-500">Beats {result.beats}% of submissions</span>
        )}
      </div>
      {(result.runtimeMs != null || result.memoryKb != null) && (
        <div className="grid grid-cols-2 gap-3">
          {result.runtimeMs != null && (
            <Tile label="Runtime" value={`${result.runtimeMs} ms`} icon={Clock} />
          )}
          {result.memoryKb != null && (
            <Tile label="Memory" value={`${(result.memoryKb / 1024).toFixed(1)} MB`} icon={MemoryStick} />
          )}
        </div>
      )}
      {result.output && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Output</div>
          <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">{result.output}</pre>
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

function Tile({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" /> {label}</div>
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

/** A pragmatic markdown renderer: backticks + bold + line breaks. Avoids a full parser dependency. */
function Markdown({ content }: { content: string }) {
  // Split paragraphs by blank line, render each
  const paragraphs = content.split(/\n\s*\n/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="mb-4 last:mb-0 whitespace-pre-line"
           dangerouslySetInnerHTML={{ __html: enrich(p) }} />
      ))}
    </>
  );
}

function enrich(s: string) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c]);
}

/**
 * Simple textarea-based code editor with basic indentation support.
 * Avoids pulling in a multi-MB editor like Monaco/CodeMirror —
 * keeps the bundle slim while still feeling responsive.
 */
function CodeMirrorLite({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = ref.current; if (!el) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const start = el.selectionStart, end = el.selectionEnd;
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
      className="flex-1 w-full p-4 bg-zinc-950 text-zinc-100 font-mono text-[13px] leading-relaxed resize-none focus:outline-none scrollbar-thin"
      style={{ tabSize: 2 }}
    />
  );
}
