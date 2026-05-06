import { Link, useNavigate, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "~/lib/auth";
import { ApiError } from "~/lib/api";
import { Logo } from "~/components/brand/Logo";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { GoogleButton } from "~/components/common/GoogleButton";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [showPwd, setShowPwd] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const next = params.get("next") || "/dashboard";

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, navigate, next]);

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
        <Button type="submit" disabled={submitting} className="w-full gradient-bg text-white border-0 h-10">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <Separator>or</Separator>

      <GoogleButton>Continue with Google</GoogleButton>

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
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex flex-col justify-between p-10 gradient-bg text-white overflow-hidden">
        <div className="absolute inset-0 opacity-30 mix-blend-overlay"
          style={{ backgroundImage: "radial-gradient(ellipse 60% 60% at 30% 20%, white, transparent 60%), radial-gradient(ellipse 60% 60% at 80% 90%, #00f, transparent 60%)" }} />
        <Link to="/" className="relative flex items-center gap-2">
          <Logo className="size-9 bg-white/15 backdrop-blur" />
          <span className="text-xl font-bold">SkillForge</span>
        </Link>
        <div className="relative max-w-md">
          <p className="text-2xl lg:text-3xl font-semibold leading-snug">
            Focus on real problems, track real progress, and keep your practice consistent.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <div className="size-10 rounded-full bg-white/20 grid place-items-center font-bold">SF</div>
            <div>
              <div className="text-sm font-semibold">SkillForge workspace</div>
              <div className="text-xs text-white/70">Algorithms · Frontend · Backend · SQL</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex justify-end p-4">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to home</Link>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="lg:hidden flex items-center gap-2 mb-8">
              <Logo className="size-8" />
              <span className="font-bold text-lg">SkillForge</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
