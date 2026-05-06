import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Sun, Moon, Save } from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { useTheme } from "~/lib/theme";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import type { User } from "~/lib/types";

export default function SettingsPage() {
  return <ProtectedRoute><Inner /></ProtectedRoute>;
}

function Inner() {
  const { user, refreshMe, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<User>>({});
  const [pwd, setPwd] = useState({ current: "", next: "" });

  useEffect(() => {
    if (user) {
      setForm({
        fullName: user.fullName || "",
        bio: user.bio || "",
        location: user.location || "",
        website: user.website || "",
        avatarUrl: user.avatarUrl || "",
      });
    }
  }, [user]);

  if (!user) return <Loading />;

  function update<K extends keyof typeof form>(k: K, v: any) {
    setForm(s => ({ ...s, [k]: v }));
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/users/me", {
        method: "PATCH",
        body: form,
      });
      await refreshMe();
      toast.success("Profile updated");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/users/me/password", { body: { currentPassword: pwd.current, newPassword: pwd.next } });
      toast.success("Password updated. Please sign in again.");
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update password");
    } finally {
      setSaving(false);
    }
  }

  async function setUserTheme(t: "dark" | "light") {
    setTheme(t);
    try { await api("/users/me", { method: "PATCH", body: { theme: t } }); } catch {}
  }

  return (
    <>
      <PageHeader title="Settings" description="Manage your profile, security and preferences." />

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <h2 className="text-base font-semibold mb-1">Profile</h2>
            <p className="text-sm text-muted-foreground mb-5">This information appears on your public profile.</p>

            <form onSubmit={saveProfile} className="space-y-5">
              <div className="flex items-center gap-4">
                <Avatar className="size-16">
                  <AvatarImage src={form.avatarUrl || user.avatarUrl || undefined} alt={user.username} />
                  <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <Label htmlFor="avatar">Avatar URL</Label>
                  <Input id="avatar" placeholder="https://…"
                    value={form.avatarUrl || ""}
                    onChange={(e) => update("avatarUrl", e.target.value)}
                    className="mt-1.5" />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="fullName">Full name</Label>
                  <Input id="fullName" value={form.fullName || ""}
                    onChange={(e) => update("fullName", e.target.value)}
                    className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" value={user.username} disabled className="mt-1.5" />
                </div>
              </div>
              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea id="bio" rows={3}
                  placeholder="Tell us about yourself"
                  value={form.bio || ""}
                  onChange={(e) => update("bio", e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" value={form.location || ""}
                    onChange={(e) => update("location", e.target.value)}
                    className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input id="website" type="url"
                    placeholder="https://your.site"
                    value={form.website || ""}
                    onChange={(e) => update("website", e.target.value)}
                    className="mt-1.5" />
                </div>
              </div>
              <div className="pt-2">
                <Button type="submit" disabled={saving} className="gradient-bg text-white border-0">
                  <Save className="size-4 mr-1.5" /> {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <h2 className="text-base font-semibold mb-1">Change password</h2>
            <p className="text-sm text-muted-foreground mb-5">Keep your account safe with a strong password.</p>
            <form onSubmit={changePassword} className="space-y-4 max-w-md">
              <div>
                <Label htmlFor="current">Current password</Label>
                <Input id="current" type="password" required value={pwd.current}
                  onChange={(e) => setPwd(p => ({ ...p, current: e.target.value }))} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="new">New password</Label>
                <Input id="new" type="password" required minLength={6}
                  value={pwd.next}
                  onChange={(e) => setPwd(p => ({ ...p, next: e.target.value }))} className="mt-1.5" />
              </div>
              <Button type="submit" disabled={saving}>{saving ? "Updating…" : "Update password"}</Button>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-6">
          <Card>
            <h2 className="text-base font-semibold mb-1">Theme</h2>
            <p className="text-sm text-muted-foreground mb-5">Choose how SkillForge looks on this device.</p>
            <div className="flex gap-3">
              <ThemeOption active={theme === "dark"} onClick={() => setUserTheme("dark")} icon={Moon} label="Dark" sample="dark" />
              <ThemeOption active={theme === "light"} onClick={() => setUserTheme("light")} icon={Sun} label="Light" sample="light" />
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-6">{children}</div>;
}

function ThemeOption({
  active, onClick, icon: Icon, label, sample,
}: { active: boolean; onClick: () => void; icon: any; label: string; sample: "dark" | "light" }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 max-w-[200px] rounded-xl border p-3 text-left transition-colors ${
        active ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-accent"
      }`}
    >
      <div className={`h-20 rounded-md mb-3 flex items-center justify-center ${
        sample === "dark" ? "bg-zinc-900" : "bg-white"
      }`}>
        <div className={`size-3 rounded-full ${sample === "dark" ? "bg-indigo-400" : "bg-indigo-600"}`} />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Icon className="size-4" />
        {label}
      </div>
    </button>
  );
}
