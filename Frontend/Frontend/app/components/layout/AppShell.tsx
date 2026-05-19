/**
 * Application chrome (topbar + sidebar) for the authenticated shell.
 *
 * Layout:
 *   - Desktop: sticky topbar (h-14, solid surface, no glass blur) +
 *     collapsible left rail (w-60 expanded, w-16 collapsed). Collapse state
 *     persists in `localStorage` under "skillforge.sidebar.collapsed".
 *   - Mobile: same topbar + a radix `Sheet` drawer triggered by the burger
 *     icon. Drawer auto-closes on navigation.
 *   - Workspace routes (problem-detail / exam / contest-problem) keep the
 *     full-screen behaviour via the `minimal` regex.
 *
 * Overhaul v1: refined sidebar with user card, gradient active indicator,
 * smoother collapse easing, cleaner topbar, page-enter animation wrapper.
 */
import { useEffect, useState, type ComponentType } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router";
import {
  LayoutDashboard,
  ListChecks,
  FolderTree,
  Trophy,
  ScrollText,
  Star,
  Settings,
  LogOut,
  Menu,
  Sun,
  Moon,
  Search,
  GraduationCap,
  BookOpen,
  PenSquare,
  ShieldCheck,
  FileClock,
  Swords,
  Ticket,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { useAuth } from "~/lib/auth";
import { useTheme } from "~/lib/theme";
import { canTeach, isAdmin, ROLE_LABEL, type Role } from "~/lib/types";
import { Logo } from "~/components/brand/Logo";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/components/ui/utils";

type IconType = ComponentType<{ className?: string }>;

interface NavItem {
  to: string;
  label: string;
  icon: IconType;
  /** When true, NavLink uses exact-match (`end`) instead of prefix-match. */
  exact?: boolean;
}

interface NavGroupSpec {
  /** Pinned top group has no title. */
  title?: string;
  icon?: IconType;
  items: NavItem[];
}

const PRACTICE: NavGroupSpec = {
  items: [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/courses", label: "Courses", icon: BookOpen },
    { to: "/problems", label: "Problems", icon: ListChecks },
    { to: "/submissions", label: "Submissions", icon: ScrollText },
    { to: "/favorites", label: "Favorites", icon: Star },
  ],
};

const COMMUNITY: NavGroupSpec = {
  title: "Community",
  items: [
    { to: "/contests", label: "Contests", icon: Swords },
    { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
    { to: "/categories", label: "Categories", icon: FolderTree },
  ],
};

const TEACH: NavGroupSpec = {
  title: "Teach",
  icon: GraduationCap,
  items: [
    { to: "/teach/courses", label: "Courses", icon: BookOpen },
    { to: "/teach/contests", label: "Contests", icon: Swords },
    { to: "/teach/problems", label: "Problems", icon: PenSquare },
  ],
};

const ADMIN: NavGroupSpec = {
  title: "Admin",
  icon: ShieldCheck,
  items: [{ to: "/admin/audit-log", label: "Audit log", icon: FileClock }],
};

const SIDEBAR_KEY = "skillforge.sidebar.collapsed";

/** Map pathname → human-readable page name for the topbar context. */
function pageTitle(pathname: string): string | null {
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname === "/courses") return "Courses";
  if (pathname.startsWith("/courses/")) return "Course";
  if (pathname === "/problems") return "Problems";
  if (pathname === "/submissions") return "Submissions";
  if (pathname === "/favorites") return "Favorites";
  if (pathname === "/contests") return "Contests";
  if (pathname.startsWith("/contests/")) return "Contest";
  if (pathname === "/leaderboard") return "Leaderboard";
  if (pathname === "/categories") return "Categories";
  if (pathname === "/settings") return "Settings";
  if (pathname.startsWith("/u/")) return "Profile";
  if (pathname.startsWith("/teach")) return "Teach";
  if (pathname.startsWith("/admin")) return "Admin";
  return null;
}

function readSidebarPref(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_KEY) === "1";
}

export default function AppShell() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Hydrate sidebar pref on mount; SSR-safe.
  useEffect(() => {
    setCollapsed(readSidebarPref());
  }, []);

  // Auto-close mobile drawer on every route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore quota / private mode errors */
      }
      return next;
    });
  }

  // Hide chrome on full-screen workspace pages (problem detail, exam workspace,
  // contest problem workspace). Same regex as the previous shell.
  const minimal =
    /^\/problems\/[^/]+\/?$/.test(location.pathname) ||
    /^\/courses\/[^/]+\/exams\/[^/]+\/?$/.test(location.pathname) ||
    /^\/contests\/[^/]+\/problems\/[^/]+\/?$/.test(location.pathname);

  const currentPage = !minimal ? pageTitle(location.pathname) : null;

  return (
    <TooltipProvider delayDuration={120}>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <Topbar
          onMenuClick={() => setMobileOpen(true)}
          minimal={minimal}
          currentPage={currentPage}
        />
        <div className="flex flex-1 min-h-0">
          {!minimal && (
            <DesktopSidebar
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
            />
          )}
          {!minimal && (
            <MobileSidebar
              open={mobileOpen}
              onOpenChange={setMobileOpen}
            />
          )}
          <main
            className={cn(
              "flex-1 min-w-0",
              !minimal && "px-4 sm:px-6 lg:px-8 py-6 lg:py-8 w-full",
            )}
          >
            {minimal ? (
              <Outlet />
            ) : (
              <div className="mx-auto max-w-[1440px] page-enter">
                <Outlet />
              </div>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ─── Topbar ────────────────────────────────────────────────────────────── */

function Topbar({
  onMenuClick,
  minimal,
  currentPage,
}: {
  onMenuClick: () => void;
  minimal: boolean;
  currentPage: string | null;
}) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/problems?search=${encodeURIComponent(q)}` : "/problems");
  }

  return (
    <header className="topbar-surface sticky top-0 z-40">
      <div className="h-14 px-3 sm:px-5 flex items-center gap-3">
        {!minimal && (
          <button
            className="lg:hidden p-2 -ml-2 rounded-md hover:bg-accent text-muted-foreground"
            onClick={onMenuClick}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
        )}

        <Link
          to={user ? "/dashboard" : "/"}
          className="flex items-center gap-2 mr-1 shrink-0"
        >
          <Logo className="size-7" />
          <span className="font-semibold text-[15px] tracking-tight hidden sm:block">
            SkillForge
          </span>
        </Link>

        {/* Page context indicator */}
        {!minimal && currentPage && (
          <div className="hidden lg:flex items-center gap-2 text-[13px] text-muted-foreground font-medium tracking-tight">
            <span className="text-border/60">/</span>
            <span className="text-foreground">{currentPage}</span>
          </div>
        )}

        {!minimal && (
          <form
            onSubmit={onSearchSubmit}
            className="hidden md:flex items-center flex-1 max-w-md ml-auto mr-auto"
          >
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search problems…"
                className="pl-9 pr-12 h-9 bg-input-background border-border rounded-full focus-visible:ring-1"
              />
              <span
                className="kbd absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden
              >
                ⌘K
              </span>
            </div>
          </form>
        )}

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
                <button className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-md hover:bg-accent transition-colors">
                  <Avatar className="size-7">
                    <AvatarImage src={user.avatarUrl ?? undefined} alt={user.username} />
                    <AvatarFallback className="text-[11px]">
                      {user.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:block text-sm font-medium">
                    {user.username}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {user.fullName || user.username}
                      </span>
                      <RoleBadge role={user.role} />
                    </div>
                    <span className="text-xs text-muted-foreground font-normal">
                      {user.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={`/u/${user.username}`}>View profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/join">Join course</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout().then(() => navigate("/"))}
                >
                  <LogOut className="size-4 mr-2" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2 ml-1">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login">Log in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/register">Sign up</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ─── Desktop sidebar ───────────────────────────────────────────────────── */

function DesktopSidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { user } = useAuth();

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "hidden lg:flex flex-col shrink-0",
        "border-r border-border-subtle bg-sidebar text-sidebar-foreground",
        "sticky top-14 h-[calc(100vh-3.5rem)]",
        "transition-[width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Collapse toggle in header */}
      <div className={cn(
        "flex items-center h-10 px-2.5 shrink-0",
        collapsed ? "justify-center" : "justify-end",
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {collapsed ? (
                <ChevronsRight className="size-4" />
              ) : (
                <ChevronsLeft className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {collapsed ? "Expand" : "Collapse"}
          </TooltipContent>
        </Tooltip>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2.5 pb-4">
        <NavGroup group={PRACTICE} collapsed={collapsed} />
        <NavGroup group={COMMUNITY} collapsed={collapsed} />
        {canTeach(user) && <NavGroup group={TEACH} collapsed={collapsed} />}
        {isAdmin(user) && <NavGroup group={ADMIN} collapsed={collapsed} />}
      </nav>

      {/* Bottom section: settings + user card */}
      <div className="border-t border-border-subtle px-2.5 py-3 space-y-1">
        <SidebarLink
          to="/settings"
          label="Settings"
          icon={Settings}
          collapsed={collapsed}
        />
        {/* User card at the bottom of sidebar */}
        {user && (
          <Link
            to={`/u/${user.username}`}
            className={cn(
              "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm",
              "text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
              collapsed && "justify-center px-0",
            )}
          >
            <Avatar className="size-6 shrink-0">
              <AvatarImage src={user.avatarUrl ?? undefined} alt={user.username} />
              <AvatarFallback className="text-[9px]">
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate leading-tight">
                  {user.fullName || user.username}
                </div>
                <div className="text-[11px] text-muted-foreground truncate leading-tight">
                  {ROLE_LABEL[user.role]}
                </div>
              </div>
            )}
          </Link>
        )}
      </div>
    </aside>
  );
}

/* ─── Mobile drawer ─────────────────────────────────────────────────────── */

function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-72 p-0 bg-sidebar text-sidebar-foreground border-r border-border-subtle"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-14 items-center gap-2 px-4 border-b border-border-subtle">
          <Logo className="size-7" />
          <span className="font-semibold text-[15px]">SkillForge</span>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-thin px-2.5 py-4">
          <NavGroup group={PRACTICE} collapsed={false} />
          <NavGroup group={COMMUNITY} collapsed={false} />
          {canTeach(user) && <NavGroup group={TEACH} collapsed={false} />}
          {isAdmin(user) && <NavGroup group={ADMIN} collapsed={false} />}
        </nav>
        <div className="border-t border-border-subtle px-2.5 py-3 space-y-1">
          <SidebarLink to="/settings" label="Settings" icon={Settings} collapsed={false} />
          {user ? (
            <Link
              to={`/u/${user.username}`}
              className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Avatar className="size-6">
                <AvatarImage src={user.avatarUrl ?? undefined} alt={user.username} />
                <AvatarFallback className="text-[9px]">
                  {user.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate leading-tight">
                  {user.fullName || user.username}
                </div>
                <div className="text-[11px] text-muted-foreground truncate leading-tight">
                  {ROLE_LABEL[user.role]}
                </div>
              </div>
            </Link>
          ) : (
            <Link
              to="/login"
              className="flex items-center justify-center w-full px-3 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Nav primitives ────────────────────────────────────────────────────── */

function NavGroup({
  group,
  collapsed,
}: {
  group: NavGroupSpec;
  collapsed: boolean;
}) {
  const Icon = group.icon;
  return (
    <div className="mb-3 last:mb-0">
      {group.title && !collapsed && (
        <div className="px-2.5 pb-1.5 pt-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          <span>{group.title}</span>
        </div>
      )}
      {group.title && collapsed && (
        <div
          className="mx-2 my-2 h-px bg-border-subtle"
          aria-hidden
        />
      )}
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <SidebarLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            exact={item.exact}
            collapsed={collapsed}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  exact,
  collapsed,
  renderIcon,
}: {
  to: string;
  label: string;
  icon: IconType;
  exact?: boolean;
  collapsed: boolean;
  /** Override the icon rendering (used for the avatar in the sidebar footer). */
  renderIcon?: () => React.ReactNode;
}) {
  const link = (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-primary/5 text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Left active indicator — solid primary bar. */}
          {isActive && !collapsed && (
            <span
              className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-md bg-primary"
              aria-hidden
            />
          )}
          {renderIcon ? renderIcon() : <Icon className={cn("size-4 shrink-0 transition-colors", isActive && "text-primary")} />}
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/* ─── Misc ──────────────────────────────────────────────────────────────── */

function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const tone =
    role === "ADMIN"
      ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
      : role === "INSTRUCTOR"
        ? "bg-sky-500/10 text-sky-500 border-sky-500/20"
        : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-[10px] leading-4 uppercase tracking-wide",
        tone,
        className,
      )}
    >
      {ROLE_LABEL[role] ?? role}
    </Badge>
  );
}
