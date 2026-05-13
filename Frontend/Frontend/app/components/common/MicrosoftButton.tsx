import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";

export function MicrosoftButton({ children = "Sign in with Microsoft", className = "" }: { children?: React.ReactNode; className?: string }) {
  const [starting, setStarting] = useState(false);

  async function start() {
    if (starting) return;
    setStarting(true);

    try {
      const next = readSafeNext();
      const query = next === "/dashboard" ? "" : `?next=${encodeURIComponent(next)}`;
      const { url } = await api<{ url: string }>(`/auth/oauth/microsoft/url${query}`, { auth: false });
      window.location.assign(url);
    } catch (error) {
      const description = error instanceof ApiError
        ? error.message
        : "Please try again in a moment.";
      toast.error("Microsoft sign-in couldn't start", { description });
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
      <MicrosoftMark className="size-4" />
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

function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
