/**
 * Shared form for creating and editing a problem.
 *
 * The backend (per `Backend/src/modules/problems/schemas.js`) accepts
 * different combinations of fields depending on `problemType`:
 *   - SQL                : sqlSetup + starterCode.sql + testCases
 *   - BACKEND / FRONTEND : functionName + starterCode + testCases
 *   - ALGORITHM          : expectedOutput OR (testCases + functionName)
 *
 * For structured fields that don't have a clean tabular UI yet
 * (`testCases`, `examples`, `starterCode`) we fall back to a JSON
 * textarea with type-specific placeholders. That keeps the UI tractable
 * for the AITU pilot — a richer per-type test-case builder is a Phase 2
 * polish job.
 *
 * On submit we always emit a payload that matches the backend's
 * CreateProblemSchema; for an edit, the parent decides which subset to
 * actually send via `onSubmit`. The backend re-validates the merged row,
 * so partial PUTs are safe.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import type { Difficulty, ProblemType, Category } from "~/lib/types";
import type {
  ProblemEditorDetail,
  StdioComparatorMode,
  StdioLanguage,
  StdioTestCase,
} from "~/lib/teaching-types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";

export interface ProblemFormState {
  slug: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  problemType: ProblemType;
  categorySlug: string;
  tags: string;                  // comma-separated; converted to string[] on submit
  examplesJson: string;          // JSON
  constraints: string;
  hintsText: string;             // newline-separated; converted to string[] on submit
  starterCodeJson: string;       // JSON
  expectedOutput: string;
  testCasesJson: string;         // JSON
  sqlSetup: string;
  functionName: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  isPremium: boolean;
  // STDIO-specific fields
  stdioTestCases: StdioTestCase[];
  outputSizeCapKb: number;
  comparatorMode: StdioComparatorMode | "";
  languageAllowlist: StdioLanguage[];
}

const DIFFICULTIES: Difficulty[] = ["EASY", "MEDIUM", "HARD"];
const PROBLEM_TYPES: ProblemType[] = ["ALGORITHM", "SQL", "BACKEND", "FRONTEND", "STDIO"];
const STDIO_LANGUAGES: StdioLanguage[] = ["JAVASCRIPT", "PYTHON", "JAVA", "GO", "CPP"];
const STDIO_COMPARATORS: { value: StdioComparatorMode; label: string }[] = [
  { value: "EXACT", label: "Exact (byte-for-byte)" },
  { value: "TRIMMED", label: "Trimmed (strip trailing newline)" },
  { value: "WHITESPACE_NORMALIZED", label: "Whitespace normalized" },
];

export function emptyFormState(): ProblemFormState {
  return {
    slug: "",
    title: "",
    description: "",
    difficulty: "EASY",
    problemType: "ALGORITHM",
    categorySlug: "",
    tags: "",
    examplesJson: "[]",
    constraints: "",
    hintsText: "",
    starterCodeJson: '{\n  "javascript": "function solve(input) {\\n  // your code here\\n}\\n"\n}',
    expectedOutput: "",
    testCasesJson: "[]",
    sqlSetup: "",
    functionName: "",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    isPremium: false,
    stdioTestCases: [{ stdin: "", expected_stdout: "", visibility: "SAMPLE" }],
    outputSizeCapKb: 64,
    comparatorMode: "",
    languageAllowlist: [],
  };
}

export function fromEditor(detail: ProblemEditorDetail): ProblemFormState {
  // Extract STDIO-specific fields if present
  const stdioDetail = detail as ProblemEditorDetail & {
    outputSizeCapKb?: number;
    comparatorMode?: StdioComparatorMode;
    languageAllowlist?: StdioLanguage[];
  };

  return {
    slug: detail.slug,
    title: detail.title,
    description: detail.description,
    difficulty: detail.difficulty,
    problemType: detail.problemType,
    categorySlug: detail.categorySlug,
    tags: (detail.tags || []).join(", "),
    examplesJson: pretty(detail.examples ?? []),
    constraints: detail.constraints || "",
    hintsText: (detail.hints || []).join("\n"),
    starterCodeJson: pretty(detail.starterCode ?? {}),
    expectedOutput: detail.expectedOutput || "",
    testCasesJson: detail.problemType === "STDIO" ? "[]" : pretty(detail.testCases ?? []),
    sqlSetup: detail.sqlSetup || "",
    functionName: detail.functionName || "",
    timeLimitMs: detail.timeLimitMs ?? 1000,
    memoryLimitMb: detail.memoryLimitMb ?? 256,
    isPremium: detail.isPremium,
    stdioTestCases: detail.problemType === "STDIO" && Array.isArray(detail.testCases)
      ? (detail.testCases as StdioTestCase[])
      : [{ stdin: "", expected_stdout: "", visibility: "SAMPLE" }],
    outputSizeCapKb: stdioDetail.outputSizeCapKb ?? 64,
    comparatorMode: stdioDetail.comparatorMode ?? "",
    languageAllowlist: stdioDetail.languageAllowlist ?? [],
  };
}

interface ParsedSubmission {
  payload: any;
  errors: Partial<Record<keyof ProblemFormState | "form", string>>;
}

/**
 * Convert form state into a backend payload, collecting per-field error
 * messages. Returns either { payload, errors: {} } or { payload: null,
 * errors: {...} } if anything failed to parse.
 */
export function buildPayload(form: ProblemFormState): ParsedSubmission {
  const errors: ParsedSubmission["errors"] = {};
  const examples = parseJson<unknown[]>(form.examplesJson, "examplesJson", errors, []);
  const starterCode = parseJson<Record<string, string>>(form.starterCodeJson, "starterCodeJson", errors, {});
  const testCasesParsed = form.testCasesJson.trim()
    ? parseJson<unknown[]>(form.testCasesJson, "testCasesJson", errors, [])
    : null;

  const tags = form.tags.split(",").map(t => t.trim()).filter(Boolean);
  const hints = form.hintsText.split("\n").map(h => h.trim()).filter(Boolean);

  const payload: any = {
    slug: form.slug.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    difficulty: form.difficulty,
    problemType: form.problemType,
    categorySlug: form.categorySlug.trim(),
    tags,
    examples,
    constraints: form.constraints,
    hints,
    starterCode,
    timeLimitMs: form.timeLimitMs,
    memoryLimitMb: form.memoryLimitMb,
    isPremium: form.isPremium,
  };

  if (testCasesParsed && Array.isArray(testCasesParsed) && testCasesParsed.length) {
    payload.testCases = testCasesParsed;
  }
  if (form.expectedOutput.trim()) payload.expectedOutput = form.expectedOutput;
  if (form.sqlSetup.trim()) payload.sqlSetup = form.sqlSetup;
  if (form.functionName.trim()) payload.functionName = form.functionName.trim();

  // STDIO: map dedicated fields into the payload
  if (form.problemType === "STDIO") {
    payload.testCases = form.stdioTestCases;
    payload.timeLimitMs = form.timeLimitMs;
    payload.memoryLimitMb = form.memoryLimitMb;
    payload.outputSizeCapKb = form.outputSizeCapKb;
    payload.comparatorMode = form.comparatorMode || undefined;
    payload.languageAllowlist = form.languageAllowlist;
    // Remove fields not relevant for STDIO
    delete payload.starterCode;
    delete payload.expectedOutput;
    delete payload.sqlSetup;
    delete payload.functionName;
  }

  // Light client-side type-specific guard rails to mirror the server validator
  // and surface obvious problems before a round-trip.
  if (form.problemType === "STDIO") {
    if (form.stdioTestCases.length === 0) {
      errors.testCasesJson = "STDIO problems require at least one test case";
    } else if (!form.stdioTestCases.some(tc => tc.visibility === "SAMPLE")) {
      errors.testCasesJson = "STDIO problems require at least one SAMPLE test case";
    }
    if (!form.comparatorMode) {
      (errors as any).comparatorMode = "Comparator mode is required";
    }
    if (form.languageAllowlist.length === 0) {
      (errors as any).languageAllowlist = "At least one language must be selected";
    }
  } else if (form.problemType === "SQL") {
    if (!form.sqlSetup.trim()) errors.sqlSetup = "SQL problems require sqlSetup";
    if (!starterCode || !starterCode.sql || !String(starterCode.sql).trim()) {
      errors.starterCodeJson = "SQL problems require starterCode.sql";
    }
    if (!payload.testCases) errors.testCasesJson = "SQL problems require testCases";
  } else if (form.problemType === "BACKEND" || form.problemType === "FRONTEND") {
    if (!form.functionName.trim()) errors.functionName = `${form.problemType} requires functionName`;
    if (!payload.testCases) errors.testCasesJson = `${form.problemType} requires testCases`;
    if (!starterCode || Object.keys(starterCode || {}).length === 0) {
      errors.starterCodeJson = `${form.problemType} requires starterCode`;
    }
  } else if (form.problemType === "ALGORITHM") {
    if (!form.expectedOutput.trim() && !payload.testCases) {
      errors.expectedOutput = "ALGORITHM problems require expectedOutput or testCases";
    }
    if (payload.testCases && !form.functionName.trim()) {
      errors.functionName = "ALGORITHM with testCases also requires functionName";
    }
  }

  return Object.keys(errors).length ? { payload: null, errors } : { payload, errors: {} };
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJson<T>(
  source: string,
  key: keyof ProblemFormState,
  errors: ParsedSubmission["errors"],
  fallback: T,
): T {
  if (!source.trim()) return fallback;
  try {
    return JSON.parse(source) as T;
  } catch (e) {
    errors[key] = `Invalid JSON: ${(e as Error).message}`;
    return fallback;
  }
}

/* ─── React component ───────────────────────────────────────────────────── */

interface Props {
  /** The "Create" page passes an empty state; "Edit" passes the loaded one. */
  initial: ProblemFormState;
  /** Title shown at the top of the form. */
  title: string;
  /** Whether the slug field can be edited (only true on create). */
  slugEditable: boolean;
  /** Submit handler — receives a payload validated by `buildPayload`. */
  onSubmit: (payload: any) => Promise<void>;
  submitLabel?: string;
}

export function ProblemForm({
  initial, title, slugEditable, onSubmit, submitLabel = "Save problem",
}: Props) {
  const [form, setForm] = useState<ProblemFormState>(initial);
  const [errors, setErrors] = useState<ParsedSubmission["errors"]>({});
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => { setForm(initial); }, [initial]);

  useEffect(() => {
    api<Category[]>("/categories").then(setCategories).catch(() => setCategories([]));
  }, []);

  function patch<K extends keyof ProblemFormState>(k: K, v: ProblemFormState[K]) {
    setForm(s => ({ ...s, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  }

  /**
   * When the problem type changes we adjust the JSON placeholders so an
   * instructor doesn't have to reverse-engineer the expected shape.
   */
  const placeholders = useMemo(() => placeholderFor(form.problemType), [form.problemType]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { payload, errors: parseErrors } = buildPayload(form);
    if (!payload) {
      setErrors(parseErrors);
      setSubmitting(false);
      toast.error("Some fields need fixing — see highlighted boxes");
      return;
    }
    try {
      await onSubmit(payload);
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(e.message);
        if (e.body?.error) setErrors({ form: String(e.body.error) });
      } else {
        toast.error("Could not save the problem");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" asChild className="text-muted-foreground">
          <Link to="/teach/problems"><ArrowLeft className="size-4 mr-1.5" /> Back</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <Button type="submit" disabled={submitting} className="gradient-bg text-white border-0">
          <Save className="size-4 mr-1.5" /> {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>

      {errors.form && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
          {errors.form}
        </div>
      )}

      {/* Identity */}
      <Card title="Basic info">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              required
              value={form.slug}
              onChange={(e) => patch("slug", e.target.value.toLowerCase())}
              disabled={!slugEditable}
              placeholder="palindrome-check"
              className="mt-1.5 font-mono text-sm"
            />
            <FieldError msg={errors.slug} />
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              required
              value={form.title}
              onChange={(e) => patch("title", e.target.value)}
              placeholder="Palindrome check"
              className="mt-1.5"
            />
            <FieldError msg={errors.title} />
          </div>
        </div>

        <div className="mt-4">
          <Label htmlFor="description">Description (Markdown)</Label>
          <Textarea
            id="description"
            required
            rows={8}
            value={form.description}
            onChange={(e) => patch("description", e.target.value)}
            placeholder="Describe the problem, the input/output contract, and any background."
            className="mt-1.5 font-mono text-sm"
          />
          <FieldError msg={errors.description} />
        </div>

        <div className="mt-4 grid sm:grid-cols-3 gap-4">
          <div>
            <Label>Difficulty</Label>
            <Select value={form.difficulty} onValueChange={(v) => patch("difficulty", v as Difficulty)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIFFICULTIES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.problemType} onValueChange={(v) => patch("problemType", v as ProblemType)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROBLEM_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.categorySlug} onValueChange={(v) => patch("categorySlug", v)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder={categories.length ? "Select a category" : "Loading…"} />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldError msg={errors.categorySlug} />
          </div>
        </div>

        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={form.tags}
              onChange={(e) => patch("tags", e.target.value)}
              placeholder="strings, two-pointers"
              className="mt-1.5"
            />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2 mt-6">
              <Switch checked={form.isPremium} onCheckedChange={(v) => patch("isPremium", v)} id="premium" />
              <Label htmlFor="premium">Premium</Label>
            </div>
          </div>
        </div>
      </Card>

      {/* Examples / hints / constraints */}
      <Card title="Statement details">
        <div>
          <Label htmlFor="examples">Examples (JSON array)</Label>
          <Textarea
            id="examples"
            rows={6}
            value={form.examplesJson}
            onChange={(e) => patch("examplesJson", e.target.value)}
            placeholder={placeholders.examples}
            className="mt-1.5 font-mono text-xs"
          />
          <FieldError msg={errors.examplesJson} />
        </div>

        <div className="mt-4">
          <Label htmlFor="constraints">Constraints</Label>
          <Textarea
            id="constraints"
            rows={3}
            value={form.constraints}
            onChange={(e) => patch("constraints", e.target.value)}
            placeholder="• 1 ≤ n ≤ 10⁵&#10;• numbers fit in 64 bits"
            className="mt-1.5 font-mono text-sm"
          />
        </div>

        <div className="mt-4">
          <Label htmlFor="hints">Hints (one per line)</Label>
          <Textarea
            id="hints"
            rows={3}
            value={form.hintsText}
            onChange={(e) => patch("hintsText", e.target.value)}
            placeholder={"Try the two-pointer technique\nUse a hash map to count..."}
            className="mt-1.5 font-mono text-sm"
          />
        </div>
      </Card>

      {/* Type-conditional grading config */}
      <Card title="Grading">
        {form.problemType === "STDIO" && (
          <StdioPanel
            testCases={form.stdioTestCases}
            onTestCasesChange={(next) => patch("stdioTestCases", next)}
            timeLimitMs={form.timeLimitMs}
            onTimeLimitChange={(v) => patch("timeLimitMs", v)}
            memoryLimitMb={form.memoryLimitMb}
            onMemoryLimitChange={(v) => patch("memoryLimitMb", v)}
            outputSizeCapKb={form.outputSizeCapKb}
            onOutputCapChange={(v) => patch("outputSizeCapKb", v)}
            comparatorMode={form.comparatorMode}
            onComparatorChange={(v) => patch("comparatorMode", v)}
            languageAllowlist={form.languageAllowlist}
            onLanguagesChange={(v) => patch("languageAllowlist", v)}
            errors={errors}
          />
        )}

        {form.problemType === "SQL" && (
          <div>
            <Label htmlFor="sqlSetup">SQL setup (DDL/DML run before each submission)</Label>
            <Textarea
              id="sqlSetup"
              rows={6}
              value={form.sqlSetup}
              onChange={(e) => patch("sqlSetup", e.target.value)}
              placeholder={"CREATE TABLE customers(...);\nINSERT INTO customers VALUES (...);"}
              className="mt-1.5 font-mono text-xs"
            />
            <FieldError msg={errors.sqlSetup} />
          </div>
        )}

        {(form.problemType === "BACKEND" || form.problemType === "FRONTEND" || form.problemType === "ALGORITHM") && (
          <div>
            <Label htmlFor="functionName">Function name (entry point)</Label>
            <Input
              id="functionName"
              value={form.functionName}
              onChange={(e) => patch("functionName", e.target.value)}
              placeholder="parseQueryString"
              className="mt-1.5 font-mono"
            />
            <FieldError msg={errors.functionName} />
          </div>
        )}

        {form.problemType !== "STDIO" && (
          <div className="mt-4">
            <Label htmlFor="starter">Starter code (JSON, language → code string)</Label>
            <Textarea
              id="starter"
              rows={8}
              value={form.starterCodeJson}
              onChange={(e) => patch("starterCodeJson", e.target.value)}
              placeholder={placeholders.starterCode}
              className="mt-1.5 font-mono text-xs"
            />
            <FieldError msg={errors.starterCodeJson} />
          </div>
        )}

        {form.problemType !== "STDIO" && (
          <div className="mt-4">
            <Label htmlFor="testCases">Test cases (JSON array)</Label>
            <Textarea
              id="testCases"
              rows={10}
              value={form.testCasesJson}
              onChange={(e) => patch("testCasesJson", e.target.value)}
              placeholder={placeholders.testCases}
              className="mt-1.5 font-mono text-xs"
            />
            <FieldError msg={errors.testCasesJson} />
          </div>
        )}

        {form.problemType === "ALGORITHM" && (
          <div className="mt-4">
            <Label htmlFor="expected">Expected output (legacy fallback)</Label>
            <Textarea
              id="expected"
              rows={4}
              value={form.expectedOutput}
              onChange={(e) => patch("expectedOutput", e.target.value)}
              placeholder="Used only when there are no testCases."
              className="mt-1.5 font-mono text-xs"
            />
            <FieldError msg={errors.expectedOutput} />
          </div>
        )}

        {form.problemType !== "STDIO" && (
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="time">Time limit (ms)</Label>
              <Input
                id="time"
                type="number"
                min={50}
                max={30000}
                value={form.timeLimitMs}
                onChange={(e) => patch("timeLimitMs", parseInt(e.target.value || "0", 10))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="mem">Memory limit (MB)</Label>
              <Input
                id="mem"
                type="number"
                min={16}
                max={2048}
                value={form.memoryLimitMb}
                onChange={(e) => patch("memoryLimitMb", parseInt(e.target.value || "0", 10))}
                className="mt-1.5"
              />
            </div>
          </div>
        )}
      </Card>
    </form>
  );
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

function placeholderFor(type: ProblemType): { examples: string; starterCode: string; testCases: string } {
  if (type === "SQL") {
    return {
      examples: '[{"input":"customers table","output":"6 rows"}]',
      starterCode: '{ "sql": "SELECT *\\nFROM customers;\\n" }',
      testCases: '[\n  { "expected": [["US", 2], ["GB", 2]] }\n]',
    };
  }
  if (type === "BACKEND" || type === "FRONTEND") {
    return {
      examples: '[{"input":"\'?a=1&b=2\'","output":"{a:\'1\', b:\'2\'}"}]',
      starterCode: '{\n  "javascript": "function solve() {\\n  // ...\\n}\\n"\n}',
      testCases: '[\n  { "name": "happy", "args": [...], "expected": ... }\n]',
    };
  }
  return {
    examples: '[{"input":"abc","output":"cba"}]',
    starterCode: '{\n  "javascript": "function solve(input) {\\n  return input;\\n}\\n"\n}',
    testCases: '[\n  { "args": [...], "expected": ... }\n]',
  };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-rose-500">{msg}</p>;
}

/* ─── STDIO Panel ───────────────────────────────────────────────────────── */

interface StdioPanelProps {
  testCases: StdioTestCase[];
  onTestCasesChange: (next: StdioTestCase[]) => void;
  timeLimitMs: number;
  onTimeLimitChange: (v: number) => void;
  memoryLimitMb: number;
  onMemoryLimitChange: (v: number) => void;
  outputSizeCapKb: number;
  onOutputCapChange: (v: number) => void;
  comparatorMode: StdioComparatorMode | "";
  onComparatorChange: (v: StdioComparatorMode | "") => void;
  languageAllowlist: StdioLanguage[];
  onLanguagesChange: (v: StdioLanguage[]) => void;
  errors: ParsedSubmission["errors"];
}

function StdioPanel({
  testCases,
  onTestCasesChange,
  timeLimitMs,
  onTimeLimitChange,
  memoryLimitMb,
  onMemoryLimitChange,
  outputSizeCapKb,
  onOutputCapChange,
  comparatorMode,
  onComparatorChange,
  languageAllowlist,
  onLanguagesChange,
  errors,
}: StdioPanelProps) {
  function updateTestCase(index: number, field: keyof StdioTestCase, value: string) {
    const next = [...testCases];
    next[index] = { ...next[index], [field]: value };
    onTestCasesChange(next);
  }

  function removeTestCase(index: number) {
    onTestCasesChange(testCases.filter((_, i) => i !== index));
  }

  function addTestCase() {
    onTestCasesChange([...testCases, { stdin: "", expected_stdout: "", visibility: "HIDDEN" }]);
  }

  function toggleLanguage(lang: StdioLanguage) {
    if (languageAllowlist.includes(lang)) {
      onLanguagesChange(languageAllowlist.filter(l => l !== lang));
    } else {
      onLanguagesChange([...languageAllowlist, lang]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Test Cases */}
      <div>
        <h3 className="text-sm font-medium mb-3">Test Cases</h3>
        <FieldError msg={errors.testCasesJson} />
        <div className="space-y-3">
          {testCases.map((tc, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Test Case #{i + 1}</span>
                <div className="flex items-center gap-3">
                  <Select
                    value={tc.visibility}
                    onValueChange={(v) => updateTestCase(i, "visibility", v)}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SAMPLE">SAMPLE</SelectItem>
                      <SelectItem value="HIDDEN">HIDDEN</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeTestCase(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Input (stdin)</Label>
                  <Textarea
                    rows={3}
                    value={tc.stdin}
                    onChange={(e) => updateTestCase(i, "stdin", e.target.value)}
                    placeholder="5&#10;1 2 3 4 5"
                    className="mt-1 font-mono text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Expected Output (stdout)</Label>
                  <Textarea
                    rows={3}
                    value={tc.expected_stdout}
                    onChange={(e) => updateTestCase(i, "expected_stdout", e.target.value)}
                    placeholder="15"
                    className="mt-1 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addTestCase}>
          <Plus className="size-3.5 mr-1.5" /> Add Test Case
        </Button>
      </div>

      {/* Limits */}
      <div>
        <h3 className="text-sm font-medium mb-3">Limits</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="stdio-time" className="text-xs">Time Limit (ms)</Label>
            <Input
              id="stdio-time"
              type="number"
              min={100}
              max={10000}
              value={timeLimitMs}
              onChange={(e) => onTimeLimitChange(parseInt(e.target.value || "0", 10))}
              className="mt-1"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">100–10,000</p>
          </div>
          <div>
            <Label htmlFor="stdio-mem" className="text-xs">Memory Limit (MB)</Label>
            <Input
              id="stdio-mem"
              type="number"
              min={16}
              max={512}
              value={memoryLimitMb}
              onChange={(e) => onMemoryLimitChange(parseInt(e.target.value || "0", 10))}
              className="mt-1"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">16–512</p>
          </div>
          <div>
            <Label htmlFor="stdio-output" className="text-xs">Output Size Cap (KB)</Label>
            <Input
              id="stdio-output"
              type="number"
              min={1}
              max={1024}
              value={outputSizeCapKb}
              onChange={(e) => onOutputCapChange(parseInt(e.target.value || "0", 10))}
              className="mt-1"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">1–1,024</p>
          </div>
        </div>
      </div>

      {/* Comparator Mode */}
      <div>
        <h3 className="text-sm font-medium mb-3">Comparator Mode</h3>
        <FieldError msg={(errors as any).comparatorMode} />
        <RadioGroup
          value={comparatorMode}
          onValueChange={(v) => onComparatorChange(v as StdioComparatorMode)}
          className="grid sm:grid-cols-3 gap-3"
        >
          {STDIO_COMPARATORS.map(c => (
            <label
              key={c.value}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem value={c.value} />
              <span className="text-xs">{c.label}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Language Allowlist */}
      <div>
        <h3 className="text-sm font-medium mb-3">Language Allowlist</h3>
        <FieldError msg={(errors as any).languageAllowlist} />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {STDIO_LANGUAGES.map(lang => (
            <label
              key={lang}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <Checkbox
                checked={languageAllowlist.includes(lang)}
                onCheckedChange={() => toggleLanguage(lang)}
              />
              <span className="text-xs font-mono">{lang}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
