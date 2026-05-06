import { Link } from "react-router";
import {
  Code2, Sparkles, Trophy, Zap, BarChart3, Users, ChevronRight,
  ArrowRight, Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "~/components/brand/Logo";
import { useAuth } from "~/lib/auth";
import { useTheme } from "~/lib/theme";
import { Button } from "~/components/ui/button";
import { api } from "~/lib/api";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import type { Category, ProblemSummary } from "~/lib/types";
import { formatNumber } from "~/lib/format";

export default function Landing() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const [previewProblems, setPreviewProblems] = useState<ProblemSummary[]>([]);
  const [stats, setStats] = useState<{ problems: number; categories: number; users: number }>({
    problems: 0, categories: 0, users: 0,
  });

  useEffect(() => {
    api<{ items: ProblemSummary[]; total: number }>("/problems?pageSize=6")
      .then(d => {
        setPreviewProblems(d.items.slice(0, 6));
        setStats(s => ({ ...s, problems: d.total }));
      })
      .catch(() => {});
    api<Category[]>("/categories")
      .then(rows => setStats(s => ({ ...s, categories: rows.length })))
      .catch(() => {});
    api<{ activeSolvers: number }>("/users/stats")
      .then(({ activeSolvers }) => setStats(s => ({ ...s, users: activeSolvers })))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 glass-panel border-b border-border/60">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="size-7" />
            <span className="font-bold text-lg tracking-tight">SkillForge</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 ml-8">
            <a href="#features" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md">Features</a>
            <a href="#problems" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md">Problems</a>
            <Link to="/leaderboard" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md">Leaderboard</Link>
            <Link to="/categories" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md">Categories</Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" className="text-muted-foreground">
              {theme === "dark" ? <Sparkles className="size-4" /> : <Sparkles className="size-4" />}
            </Button>
            {user ? (
              <Button asChild className="gradient-bg text-white border-0"><Link to="/dashboard">Open dashboard</Link></Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild><Link to="/login">Log in</Link></Button>
                <Button size="sm" className="gradient-bg text-white border-0" asChild>
                  <Link to="/register">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 opacity-60">
          <div className="absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,color-mix(in_oklab,var(--brand-indigo)_25%,transparent),transparent)]" />
        </div>
        <div className="max-w-7xl mx-auto px-5 pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              v1.0 — open beta
            </span>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
              Practice like a <span className="gradient-text">mammoth</span>.<br />
              Ship like a <span className="gradient-text">pro.</span>
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-xl">
              SkillForge is a focused, modern coding-practice platform. Real problems, instant feedback,
              progress tracking and a friendly community — without the noise.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" className="gradient-bg text-white border-0 h-11 px-6" asChild>
                <Link to={user ? "/problems" : "/register"}>
                  {user ? "Browse problems" : "Start solving"} <ArrowRight className="size-4 ml-1" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-11 px-6" asChild>
                <Link to="/leaderboard"><Trophy className="size-4 mr-2" /> See leaderboard</Link>
              </Button>
            </div>

            <dl className="mt-10 grid grid-cols-3 gap-8 max-w-md">
              <Stat label="Problems" value={stats.problems} suffix={stats.problems > 0 ? "+" : ""} />
              <Stat label="Categories" value={stats.categories} />
              <Stat label="Active solvers" value={stats.users} />
            </dl>
          </div>

          {/* Hero card mock */}
          <div className="relative">
            <HeroCodeMock />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-border bg-card/30 py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-5">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">Why SkillForge</p>
            <h2 className="mt-2 text-3xl lg:text-4xl font-bold tracking-tight">A platform built for deliberate practice</h2>
            <p className="mt-3 text-muted-foreground">
              Curated problems, instant feedback, and a clean focus mode so you can practice without distractions.
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Feature icon={Code2}    title="Problem-first workspace"
              text="A split workspace with description, code editor and test runner — all keyboard-friendly." />
            <Feature icon={Zap}      title="Instant feedback"
              text="Run sample tests in milliseconds, submit for the full grader, and see how you compare." />
            <Feature icon={BarChart3} title="Progress that compounds"
              text="Track solved problems, streaks, ratings and a full submission timeline." />
            <Feature icon={Trophy}   title="Live leaderboard"
              text="Climb the ranks across difficulty tiers, with an Elo-style rating that grows with you." />
            <Feature icon={Sparkles} title="Smart organisation"
              text="Browse by category, difficulty, or status. Save favourites for later focused study." />
            <Feature icon={Users}    title="Made for teams"
              text="Self-host SkillForge locally and share a private problem set with classmates or coworkers." />
          </div>
        </div>
      </section>

      {/* Problems preview */}
      <section id="problems" className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-5">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <p className="text-sm font-medium text-primary">Featured problems</p>
              <h2 className="mt-2 text-3xl lg:text-4xl font-bold tracking-tight">Start with the classics</h2>
            </div>
            <Button variant="outline" asChild><Link to="/problems">All problems <ChevronRight className="size-4 ml-1" /></Link></Button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {previewProblems.map((p, i) => (
              <Link key={p.id}
                to={`/problems/${p.slug}`}
                className="group rounded-xl border border-border bg-card hover:border-primary/40 transition-colors p-5 flex flex-col"
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">#{String(i + 1).padStart(3, "0")}</span>
                  <DifficultyBadge difficulty={p.difficulty} />
                </div>
                <h3 className="mt-3 font-semibold group-hover:text-primary transition-colors">{p.title}</h3>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.tags.slice(0, 3).map(t => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground">{t}</span>
                  ))}
                </div>
                <div className="mt-auto pt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatNumber(p.totalSubmissions)} submissions</span>
                  <span className="font-medium">{p.acceptanceRate}% AC</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-5">
          <div className="rounded-3xl gradient-bg p-10 lg:p-16 text-white relative overflow-hidden">
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white, transparent 50%)" }} />
            <div className="relative">
              <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">Ready to grow your craft?</h2>
              <p className="mt-3 text-white/80 max-w-xl">
                Sign up free, solve your first problem in minutes, and let SkillForge handle the rest.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-11 px-6" asChild>
                  <Link to="/register">Create free account</Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 h-11 px-6" asChild>
                  <Link to="/login">I already have an account</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-10 mt-auto">
        <div className="max-w-7xl mx-auto px-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo className="size-6" />
            <span className="text-sm font-semibold">SkillForge</span>
            <span className="text-sm text-muted-foreground">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/problems" className="hover:text-foreground">Problems</Link>
            <Link to="/leaderboard" className="hover:text-foreground">Leaderboard</Link>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
            <Link to="/register" className="hover:text-foreground inline-flex items-center gap-1.5">
              <Star className="size-4" /> Get started
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold gradient-text">{value}{suffix}</dd>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 hover:border-primary/40 transition-colors">
      <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function HeroCodeMock() {
  return (
    <div className="relative">
      <div className="rounded-2xl glass-panel shadow-2xl shadow-primary/10 overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/60 bg-muted/30">
          <span className="size-2.5 rounded-full bg-rose-500/70" />
          <span className="size-2.5 rounded-full bg-amber-500/70" />
          <span className="size-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-3 text-xs text-muted-foreground font-mono">two-sum.ts — Accepted ✓</span>
        </div>
        <pre className="px-5 py-5 text-[12.5px] leading-relaxed font-mono overflow-x-auto scrollbar-thin">
<span className="text-purple-400">function</span> <span className="text-sky-400">twoSum</span>(<span className="text-amber-300">nums</span>: number[], <span className="text-amber-300">target</span>: number) {`{`}{"\n"}
{"  "}<span className="text-purple-400">const</span> map = <span className="text-purple-400">new</span> <span className="text-sky-400">Map</span>&lt;number, number&gt;();{"\n"}
{"  "}<span className="text-purple-400">for</span> (<span className="text-purple-400">let</span> i = <span className="text-emerald-400">0</span>; i {`<`} nums.length; i++) {`{`}{"\n"}
{"    "}<span className="text-purple-400">const</span> need = target - nums[i];{"\n"}
{"    "}<span className="text-purple-400">if</span> (map.has(need)) <span className="text-purple-400">return</span> [map.get(need)!, i];{"\n"}
{"    "}map.set(nums[i], i);{"\n"}
{"  }"}{"\n"}
{"}"}{"\n"}
        </pre>
        <div className="border-t border-border/60 px-5 py-3 grid grid-cols-3 gap-3 bg-muted/20 text-xs">
          <Metric label="Runtime" value="52 ms" tone="success" />
          <Metric label="Memory" value="42.1 MB" tone="success" />
          <Metric label="Beats" value="92.5%" tone="success" />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "success" | "default" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === "success" ? "text-emerald-500 font-medium" : "font-medium"}>{value}</span>
    </div>
  );
}
