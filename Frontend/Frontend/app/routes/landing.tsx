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
import { cn } from "~/components/ui/utils";

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
    <div className="min-h-screen flex flex-col bg-background">
      {/* Topbar */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="size-6" />
            <span className="font-semibold text-base tracking-tight">SkillForge</span>
          </Link>
          <nav className="hidden md:flex items-center gap-2 ml-8">
            <a href="#features" className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md">Features</a>
            <a href="#problems" className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md">Problems</a>
            <Link to="/leaderboard" className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md">Leaderboard</Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" className="text-muted-foreground rounded-full size-8">
              <Sparkles className="size-4" />
            </Button>
            {user ? (
              <Button asChild size="sm" className="rounded-full h-8 px-4"><Link to="/dashboard">Dashboard</Link></Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" className="rounded-full h-8 px-4 font-medium" asChild><Link to="/login">Log in</Link></Button>
                <Button size="sm" className="rounded-full h-8 px-4 font-medium bg-foreground text-background hover:bg-foreground/90" asChild>
                  <Link to="/register">Sign up</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section - Linear Style */}
      <section className="relative flex flex-col items-center justify-center pt-28 lg:pt-36 pb-20 overflow-hidden text-center">
        {/* Spotlight ambient glow */}
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="relative z-10 max-w-4xl mx-auto px-5 flex flex-col items-center">
          {/* Massive Typography */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tighter leading-[1.05] bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/50 pb-2">
            A new standard for<br />
            software engineering
          </h1>
          
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl font-medium tracking-tight">
            Move beyond toy algorithms. SkillForge provides full-stack environments, instant test feedback, and professional problem sets to forge true engineering skills.
          </p>
          
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" className="h-12 px-8 text-base font-semibold rounded-full shadow-[0_0_30px_rgba(var(--primary-rgb),0.2)] hover:shadow-[0_0_40px_rgba(var(--primary-rgb),0.4)] transition-shadow bg-foreground text-background hover:bg-foreground/90" asChild>
              <Link to={user ? "/problems" : "/register"}>
                {user ? "Browse problems" : "Start building"}
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 text-base font-semibold rounded-full bg-background/50 border-border hover:bg-accent backdrop-blur-sm" asChild>
              <Link to="/leaderboard">Explore curriculum</Link>
            </Button>
          </div>
        </div>

        {/* Hero Image Mockup (Centered, glowing, fades out at bottom) */}
        <div className="relative w-full max-w-5xl mx-auto mt-24 px-5 z-10">
           {/* Glow behind the mockup */}
           <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[80%] h-[80%] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />
           <div className="relative rounded-xl border border-border/60 bg-background/80 shadow-2xl backdrop-blur-xl overflow-hidden ring-1 ring-white/5">
              <HeroCodeMock />
              {/* Fade out mask at bottom to blend into the next section */}
              <div className="absolute inset-x-0 bottom-[-2px] h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />
           </div>
        </div>
      </section>

      {/* Features - Minimalist Cards */}
      <section id="features" className="py-24 border-t border-border/40 bg-background relative">
        <div className="max-w-7xl mx-auto px-5 relative z-10">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
              Designed for deliberate practice
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Curated problems, instant feedback, and a clean focus mode.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
      <section id="problems" className="py-24 border-t border-border/40 bg-background relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-5 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
                Start with the classics
              </h2>
              <p className="mt-3 text-muted-foreground text-lg">Featured problems to get you warmed up.</p>
            </div>
            <Button variant="outline" className="rounded-full h-10 px-6 shrink-0 bg-background/50 backdrop-blur-sm" asChild>
              <Link to="/problems">View all problems <ChevronRight className="size-4 ml-1" /></Link>
            </Button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {previewProblems.map((p, i) => (
              <Link key={p.id}
                to={`/problems/${p.slug}`}
                className="group flex flex-col rounded-xl border border-border/60 bg-card/40 hover:bg-card/80 transition-all duration-300 p-6 hover:shadow-md hover:border-border"
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
                  <span className="font-mono tracking-widest uppercase">#{String(i + 1).padStart(3, "0")}</span>
                  <DifficultyBadge difficulty={p.difficulty} />
                </div>
                <h3 className="font-semibold text-lg group-hover:text-primary transition-colors tracking-tight">{p.title}</h3>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.tags.slice(0, 3).map(t => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border border-border/50 bg-background text-muted-foreground font-medium">{t}</span>
                  ))}
                </div>
                <div className="mt-auto pt-6 flex items-center justify-between text-xs text-muted-foreground font-medium">
                  <span>{formatNumber(p.totalSubmissions)} submissions</span>
                  <span className="text-foreground">{p.acceptanceRate}% AC</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 border-t border-border/40 relative overflow-hidden bg-background">
        <div className="absolute inset-0 top-[-50%] left-1/2 -translate-x-1/2 w-full max-w-[1000px] h-full bg-[radial-gradient(ellipse_at_center,var(--brand-indigo)_0%,transparent_70%)] opacity-10 blur-[100px] pointer-events-none" />
        <div className="max-w-4xl mx-auto px-5 text-center relative z-10">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
            Ready to grow your craft?
          </h2>
          <p className="mt-5 text-xl text-muted-foreground max-w-2xl mx-auto">
            Sign up free, solve your first problem in minutes, and let SkillForge handle the rest.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" className="h-12 px-8 text-base font-semibold rounded-full bg-foreground text-background hover:bg-foreground/90 shadow-lg" asChild>
              <Link to="/register">Create free account</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 text-base font-semibold rounded-full bg-background/50 border-border hover:bg-accent backdrop-blur-sm" asChild>
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40 py-12 bg-background">
        <div className="max-w-7xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Logo className="size-5 text-muted-foreground" />
            <span className="text-sm font-semibold tracking-tight text-muted-foreground">SkillForge</span>
            <span className="text-sm text-muted-foreground/60 ml-2">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm font-medium text-muted-foreground">
            <Link to="/problems" className="hover:text-foreground transition-colors">Problems</Link>
            <Link to="/leaderboard" className="hover:text-foreground transition-colors">Leaderboard</Link>
            <Link to="/login" className="hover:text-foreground transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/30 p-6 hover:bg-card/80 transition-all duration-300">
      <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mb-5 shadow-sm">
        <Icon className="size-5" />
      </div>
      <h3 className="font-semibold text-foreground tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}

function HeroCodeMock() {
  return (
    <div className="w-full text-left">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/30">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <span className="ml-4 text-[11px] font-medium text-muted-foreground font-mono tracking-wider">solution.ts</span>
      </div>
      <div className="relative">
        <pre className="px-6 py-6 text-[13px] leading-relaxed font-mono overflow-x-auto scrollbar-thin text-foreground/90">
<span className="text-[#c678dd]">function</span> <span className="text-[#61afef]">twoSum</span>(<span className="text-[#e5c07b]">nums</span>: number[], <span className="text-[#e5c07b]">target</span>: number) {`{`}{"\n"}
{"  "}<span className="text-[#c678dd]">const</span> map = <span className="text-[#c678dd]">new</span> <span className="text-[#61afef]">Map</span>&lt;number, number&gt;();{"\n"}
{"  "}<span className="text-[#c678dd]">for</span> (<span className="text-[#c678dd]">let</span> i = <span className="text-[#d19a66]">0</span>; i {`<`} nums.length; i++) {`{`}{"\n"}
{"    "}<span className="text-[#c678dd]">const</span> need = target - nums[i];{"\n"}
{"    "}<span className="text-[#c678dd]">if</span> (map.has(need)) <span className="text-[#c678dd]">return</span> [map.get(need)!, i];{"\n"}
{"    "}map.set(nums[i], i);{"\n"}
{"  }"}{"\n"}
{"}"}{"\n"}
        </pre>
      </div>
      <div className="border-t border-border/50 px-6 py-3 flex gap-6 bg-muted/20 text-[11px] font-mono tracking-wider">
        <Metric label="STATUS" value="ACCEPTED" tone="success" />
        <Metric label="RUNTIME" value="52ms" />
        <Metric label="MEMORY" value="42.1MB" />
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "success" | "default" }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === "success" ? "text-emerald-500 font-bold" : "text-foreground font-bold"}>{value}</span>
    </div>
  );
}
