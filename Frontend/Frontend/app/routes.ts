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
  ]),

  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
