import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";

export function GoogleButton({ children = "Continue with Google", className = "" }: { children?: React.ReactNode; className?: string }) {
  const [starting, setStarting] = useState(false);

  async function start() {
    if (starting) return;
    setStarting(true);

    try {
      const next = readSafeNext();
      const query = next === "/dashboard" ? "" : `?next=${encodeURIComponent(next)}`;
      const { url } = await api<{ url: string }>(`/auth/google/url${query}`, { auth: false });
      window.location.assign(url);
    } catch (error) {
      const description = error instanceof ApiError
        ? error.message
        : "Please try again in a moment.";
      toast.error("Google sign-in couldn't start", { description });
      setStarting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={starting}
      className={
        "w-full inline-flex items-center justify-center gap-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors px-4 py-2.5 text-sm font-medium disabled:pointer-events-none disabled:opacity-70 " +
        className
      }
    >
      <GoogleMark className="size-4" />
      {starting ? "Redirecting…" : children}
    </button>
  );
}

function readSafeNext() {
  if (typeof window === "undefined") return "/dashboard";
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 12.7 4.5 3.5 13.7 3.5 25S12.7 45.5 24 45.5 44.5 36.3 44.5 25c0-1.5-.2-3-.4-4.5z"/>
      <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8C14.7 15 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.1 4.5 9.3 9 6.3 14.1z"/>
      <path fill="#4CAF50" d="M24 45.5c5.4 0 10.3-2.1 14-5.5l-6.5-5.4c-2 1.4-4.6 2.4-7.5 2.4-5.3 0-9.7-3.3-11.3-8l-6.5 5.1C9.2 41 16 45.5 24 45.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.4c4.6-4.2 7.3-10.4 7.3-17.4 0-1.5-.2-3-.4-4.5z"/>
    </svg>
  );
}
