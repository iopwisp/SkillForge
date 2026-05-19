import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import type { Route } from "./+types/root";

import "../styles/index.css";

import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { Toaster } from "./components/ui/sonner";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#5b5bd6" />
        <title>SkillForge — A modern coding practice platform</title>
        <meta name="description" content="Practice coding problems, track progress, and climb the leaderboard on SkillForge." />
        <Meta />
        <Links />
        <script
          // Avoid theme flash on first paint
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('skillforge.theme');
                if (!t) t = 'light';
                if (t === 'dark') document.documentElement.classList.add('dark');
                document.documentElement.style.colorScheme = t;
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="antialiased min-h-screen">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try again.";
  let status: number | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    title = error.status === 404 ? "Page not found" : `${error.status} ${error.statusText}`;
    message = error.status === 404
      ? "The page you’re looking for doesn’t exist or has been moved."
      : (error.data as any)?.message || error.statusText;
  } else if (import.meta.env.DEV && error instanceof Error) {
    message = error.message;
  }

  return <ErrorPage title={title} message={message} status={status} />;
}

function ErrorPage({ title, message, status }: { title: string; message: string; status?: number }) {
  const navigate = useNavigate();
  return (
    <main className="grid min-h-screen place-items-center px-6 py-24">
      <div className="text-center max-w-lg">
        <p className="font-mono text-7xl font-bold gradient-text">
          {status ?? "!"}
        </p>
        <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-muted-foreground">{message}</p>
        <div className="mt-8 flex justify-center gap-3">
          <button
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
            onClick={() => navigate("/")}
          >
            Back to home
          </button>
          <button
            className="px-4 py-2 rounded-md border border-border hover:bg-accent text-sm font-medium"
            onClick={() => navigate(-1)}
          >
            Go back
          </button>
        </div>
      </div>
    </main>
  );
}
