import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard, ListChecks, FolderTree, Trophy, ScrollText, Star, Settings,
  LogOut, Menu, X, Sun, Moon, Search, Sparkles,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "~/lib/auth";
import { useTheme } from "~/lib/theme";
import { Logo } from "~/components/brand/Logo";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

const NAV = [
  { to: "/dashboard",   label: "Dashboard",  icon: LayoutDashboard },
  { to: "/problems",    label: "Problems",   icon: ListChecks },
  { to: "/categories",  label: "Categories", icon: FolderTree },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/submissions", label: "Submissions", icon: ScrollText },
  { to: "/favorites",   label: "Favorites",  icon: Star },
];

export default function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Hide chrome on the problem-solving page (full-screen workspace)
  const minimal = /^\/problems\/[^/]+\/?$/.test(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar onMenuClick={() => setOpen(o => !o)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar open={open} onClose={() => setOpen(false)} hidden={minimal} />
        <main className={`flex-1 min-w-0 ${minimal ? "" : "px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1500px] w-full mx-auto"}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return navigate("/problems");
    navigate(`/problems?search=${encodeURIComponent(search.trim())}`);
  }

  return (
    <header className="sticky top-0 z-40 glass-panel border-b border-border/60">
      <div className="h-14 px-3 sm:px-5 flex items-center gap-3">
        <button
          className="lg:hidden p-2 -ml-2 rounded-md hover:bg-accent text-muted-foreground"
          onClick={onMenuClick}
          aria-label="Toggle navigation"
        >
          <Menu className="size-5" />
        </button>

        <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-2 mr-2">
          <Logo className="size-7" />
          <span className="font-bold text-lg tracking-tight hidden sm:block">SkillForge</span>
        </Link>

        <form onSubmit={onSearchSubmit} className="hidden md:flex items-center flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search problems, tags, categories…"
              className="pl-9 h-9 bg-input/50 border-border focus-visible:ring-1"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="Toggle theme"
            className="text-muted-foreground hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-md hover:bg-accent">
                  <Avatar className="size-7">
                    <AvatarImage src={user.avatarUrl ?? undefined} alt={user.username} />
                    <AvatarFallback>{user.username.slice(0,2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:block text-sm font-medium">{user.username}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{user.fullName || user.username}</span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to={`/u/${user.username}`}>View profile</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/dashboard">Dashboard</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/settings">Settings</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout().then(() => navigate("/"))}>
                  <LogOut className="size-4 mr-2" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2 ml-1">
              <Button variant="ghost" size="sm" asChild><Link to="/login">Log in</Link></Button>
              <Button size="sm" className="gradient-bg text-white border-0" asChild>
                <Link to="/register"><Sparkles className="size-3.5 mr-1.5" /> Sign up</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function Sidebar({ open, onClose, hidden }: { open: boolean; onClose: () => void; hidden: boolean }) {
  const { user } = useAuth();
  if (hidden) return null;
  return (
    <>
      {/* Mobile drawer backdrop */}
      <div
        onClick={onClose}
        className={`lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-30 transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside className={`
        z-30 flex flex-col w-64 shrink-0 border-r border-border/60 bg-sidebar
        lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)]
        fixed top-0 left-0 h-screen pt-16 lg:pt-4 px-3 pb-4 transition-transform
        ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
      `}>
        <button
          className="lg:hidden absolute top-3 right-3 p-2 rounded-md text-muted-foreground hover:bg-accent"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X className="size-4" />
        </button>

        <nav className="flex flex-col gap-0.5 mt-2">
          {NAV.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                end
                className={({ isActive }) => `
                  group flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                  transition-colors
                  ${isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"}
                `}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-border/60 pt-3">
          <NavLink
            to="/settings"
            onClick={onClose}
            className={({ isActive }) => `
              flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              ${isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}
            `}
          >
            <Settings className="size-4" /> Settings
          </NavLink>
          {!user && (
            <Link
              to="/login"
              onClick={onClose}
              className="mt-2 flex items-center justify-center w-full px-3 py-2 rounded-lg text-sm gradient-bg text-white"
            >
              Sign in to SkillForge
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
