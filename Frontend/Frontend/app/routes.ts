import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/landing.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("auth/callback", "routes/auth-callback.tsx"),

  layout("components/layout/AppShell.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("problems", "routes/problems.tsx"),
    route("problems/:slug", "routes/problem-detail.tsx"),
    route("categories", "routes/categories.tsx"),
    route("leaderboard", "routes/leaderboard.tsx"),
    route("submissions", "routes/submissions.tsx"),
    route("favorites", "routes/favorites.tsx"),
    route("settings", "routes/settings.tsx"),
    route("u/:username", "routes/profile.tsx"),
    route("u/:username/contests", "routes/profile-contests.tsx"),

    /* Student course / exam surfaces */
    route("courses", "routes/courses.tsx"),
    route("courses/:slug", "routes/course-detail.tsx"),
    route("courses/:slug/exams/:examSlug", "routes/exam.tsx"),

    /* Contest surfaces. */
    route("contests", "routes/contests.tsx"),
    route("contests/:slug", "routes/contest-detail.tsx"),
    route("contests/:slug/standings", "routes/contest-standings.tsx"),
    route("contests/:slug/problems/:letter", "routes/contest-problem.tsx"),

    /* Instructor / admin surfaces (gated by RoleGuard inside each page). */
    route("teach", "routes/teach/index.tsx"),
    route("teach/problems", "routes/teach/problems.tsx"),
    route("teach/problems/new", "routes/teach/problem-new.tsx"),
    route("teach/problems/:slug/edit", "routes/teach/problem-edit.tsx"),
    route("teach/courses", "routes/teach/courses.tsx"),
    route("teach/courses/:slug", "routes/teach/course-detail.tsx"),
    route("teach/courses/:slug/live", "routes/teach/live-dashboard.tsx"),

    route("admin", "routes/admin/index.tsx"),
    route("admin/audit-log", "routes/admin/audit-log.tsx"),
  ]),

  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
