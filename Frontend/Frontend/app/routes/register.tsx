import { Link, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "~/lib/auth";
import { api, ApiError } from "~/lib/api";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { GoogleButton } from "~/components/common/GoogleButton";
import { MicrosoftButton } from "~/components/common/MicrosoftButton";
import { AuthLayout } from "./login";

interface AuthProvider {
  name: string;
  type: string;
  enabled: boolean;
  supportsOAuthRedirect?: boolean;
}

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [showPwd, setShowPwd] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", fullName: "" });
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<AuthProvider[]>([]);

  useEffect(() => { if (user) navigate("/dashboard", { replace: true }); }, [user, navigate]);

  useEffect(() => {
    api<AuthProvider[]>("/auth/providers", { auth: false })
      .then(setProviders)
      .catch(() => {});
  }, []);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm(s => ({ ...s, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(form);
      toast.success(`Welcome to SkillForge, ${form.username}!`);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not create account";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Join SkillForge — it’s free and takes 30 seconds">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" required minLength={3} maxLength={32}
              pattern="[-a-zA-Z0-9_]+"
              placeholder="username"
              value={form.username}
              onChange={(e) => update("username", e.target.value)}
              className="mt-1.5"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName"
              placeholder="Name"
              value={form.fullName}
              onChange={(e) => update("fullName", e.target.value)}
              className="mt-1.5"
              autoComplete="name"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className="mt-1.5"
            autoComplete="email"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <div className="relative mt-1.5">
            <Input id="password" type={showPwd ? "text" : "password"}
              required minLength={6}
              placeholder="at least 6 characters"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              className="pr-10"
              autoComplete="new-password"
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
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex-1 h-px bg-border" /><span>or</span><span className="flex-1 h-px bg-border" />
      </div>

      {providers.some(p => p.name === "google" && p.enabled) && (
        <GoogleButton>Sign up with Google</GoogleButton>
      )}
      {providers.some(p => p.name === "microsoft" && p.enabled) && (
        <MicrosoftButton className="mt-3">Sign up with Microsoft</MicrosoftButton>
      )}

      <p className="mt-6 text-sm text-muted-foreground text-center">
        Already on SkillForge? <Link to="/login" className="text-primary font-medium">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
