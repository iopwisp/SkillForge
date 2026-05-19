import { Link, useNavigate, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "~/lib/auth";
import { api, ApiError } from "~/lib/api";
import { Logo } from "~/components/brand/Logo";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { GoogleButton } from "~/components/common/GoogleButton";
import { MicrosoftButton } from "~/components/common/MicrosoftButton";

interface AuthProvider {
  name: string;
  type: string;
  enabled: boolean;
  supportsOAuthRedirect?: boolean;
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [showPwd, setShowPwd] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<AuthProvider[]>([]);

  const next = params.get("next") || "/dashboard";

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, navigate, next]);

  useEffect(() => {
    api<AuthProvider[]>("/auth/providers", { auth: false })
      .then(setProviders)
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
      toast.success("Welcome back!");
      navigate(next, { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not sign in";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue your practice on SkillForge">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="identifier">Email or username</Label>
          <Input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="username or you@example.com"
            autoComplete="username"
            autoFocus
            required
            className="mt-1.5"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <span className="text-xs text-muted-foreground">forgot? <span className="text-primary cursor-not-allowed opacity-70">reset</span></span>
          </div>
          <div className="relative mt-1.5">
            <Input
              id="password"
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              minLength={6}
              className="pr-10"
            />
            <button type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:bg-accent"
              onClick={() => setShowPwd(s => !s)}
              tabIndex={-1}
            >
              {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" disabled={submitting} className="w-full h-11 font-semibold rounded-xl bg-foreground text-background hover:bg-foreground/90 shadow-sm transition-all">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <Separator>or</Separator>

      {providers.some(p => p.name === "google" && p.enabled) && (
        <GoogleButton>Continue with Google</GoogleButton>
      )}
      {providers.some(p => p.name === "microsoft" && p.enabled) && (
        <MicrosoftButton className="mt-3" />
      )}

      <p className="mt-6 text-sm text-muted-foreground text-center">
        New here? <Link to="/register" className="text-primary font-medium">Create an account</Link>
      </p>
    </AuthLayout>
  );
}

function Separator({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex-1 h-px bg-border" />
      <span>{children}</span>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Left panel — theme-aware but visually rich */}
      <div className="relative hidden lg:flex flex-col items-center justify-center bg-card/30 border-r border-border/40 overflow-hidden">
        {/* Ambient glows */}
        <div className="absolute top-[10%] left-[20%] w-[500px] h-[500px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[5%] right-[10%] w-[400px] h-[400px] bg-primary/5 blur-[100px] rounded-full pointer-events-none" />
        {/* Dot grid pattern (adaptive) */}
        <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.1] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

        {/* Logo top-left */}
        <Link to="/" className="absolute top-8 left-8 flex items-center gap-2.5 z-10">
          <Logo className="size-7" />
          <span className="text-lg font-semibold tracking-tight">SkillForge</span>
        </Link>

        {/* Center content */}
        <div className="relative z-10 flex flex-col items-center text-center px-12 max-w-lg mt-12">
          <p className="text-3xl lg:text-4xl font-bold leading-[1.15] tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-foreground to-foreground/60">
            A new standard for<br />engineering practice.
          </p>
          <p className="mt-4 text-sm text-muted-foreground max-w-sm leading-relaxed">
            Real problems, instant feedback, and professional problem sets to forge true engineering skills.
          </p>

          {/* Floating code card */}
          <div className="mt-10 w-full rounded-xl border border-border/60 bg-card/60 shadow-xl backdrop-blur-md overflow-hidden text-left">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-muted/30">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-border" />
                <span className="size-2.5 rounded-full bg-border" />
                <span className="size-2.5 rounded-full bg-border" />
              </div>
              <span className="ml-3 text-[11px] font-mono text-muted-foreground tracking-wider">solution.ts</span>
            </div>
            <pre className="px-5 py-4 text-[12px] leading-relaxed font-mono text-foreground/80 overflow-hidden">
<span className="text-[#c678dd]">function</span> <span className="text-[#61afef]">twoSum</span>(<span className="text-[#e5c07b]">nums</span>: number[], <span className="text-[#e5c07b]">target</span>: number) {`{`}{"\n"}
{"  "}<span className="text-[#c678dd]">const</span> map = <span className="text-[#c678dd]">new</span> <span className="text-[#61afef]">Map</span>();{"\n"}
{"  "}<span className="text-[#c678dd]">for</span> (<span className="text-[#c678dd]">let</span> i = <span className="text-[#d19a66]">0</span>; i {"<"} nums.length; i++) {`{`}{"\n"}
{"    "}<span className="text-[#c678dd]">if</span> (map.has(target - nums[i])){"\n"}
{"      "}<span className="text-[#c678dd]">return</span> [map.get(target - nums[i]), i];{"\n"}
{"    "}map.set(nums[i], i);{"\n"}
{"  }"}{"\n"}
{"}"}</pre>
            <div className="border-t border-border/60 px-5 py-3 flex items-center gap-5 text-[11px] font-mono tracking-wider text-muted-foreground bg-muted/20">
              <span><span className="text-emerald-500 font-bold">✓</span> ACCEPTED</span>
              <span>52ms</span>
              <span>42.1MB</span>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-10 flex items-center justify-center gap-8 text-muted-foreground text-xs">
            <div className="text-center">
              <div className="text-xl font-bold text-foreground tabular-nums">200+</div>
              <div className="mt-0.5">Problems</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <div className="text-xl font-bold text-foreground tabular-nums">5</div>
              <div className="mt-0.5">Languages</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <div className="text-xl font-bold text-foreground tabular-nums">∞</div>
              <div className="mt-0.5">Practice</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-col relative overflow-hidden">
        <div className="flex justify-end p-6 relative z-10">
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">← Back to home</Link>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 relative z-10">
          <div className="w-full max-w-sm">
            <div className="lg:hidden flex items-center gap-2 mb-10">
              <Logo className="size-8" />
              <span className="font-semibold text-lg tracking-tight">SkillForge</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
