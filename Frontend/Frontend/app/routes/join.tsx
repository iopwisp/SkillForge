/**
 * Student-facing invite-code redemption.
 *
 * Counterpart to the instructor "generate invite" flow in the teach
 * groups panel. Any authenticated user may enter a code — the code
 * itself is the credential. Pre-fills from `?code=...` so a shared
 * URL like `/join?code=ABCD-1234` lands straight on a populated form.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Ticket } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "~/lib/api";
import { ProtectedRoute } from "~/lib/guards";
import { PageHeader } from "~/components/common/PageHeader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { JoinByInviteResponse } from "~/lib/teaching-types";

export default function JoinPage() {
  return (
    <ProtectedRoute>
      <JoinContent />
    </ProtectedRoute>
  );
}

/**
 * Cosmetic normaliser. Accepts both `ABCD-1234` and `abcd1234`, strips
 * surrounding whitespace, uppercases, and re-inserts the canonical dash
 * when the length is right. The backend does its own normalisation, so
 * this is purely UX — the user sees the code formatted as we'd store it.
 */
function prettifyCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length <= 4) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

function JoinContent() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from `?code=...` on mount so shared links land on a ready
  // form. We deliberately run this once, not on every search change, so
  // the user can still edit the field after the initial fill.
  useEffect(() => {
    const raw = searchParams.get("code");
    if (raw) setCode(prettifyCode(raw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleaned = code.replace(/[^A-Za-z0-9]/g, "");
    if (cleaned.length < 4) {
      setError("Enter the full code your instructor shared.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<JoinByInviteResponse>("/groups/join", {
        method: "POST",
        body: { code: cleaned.toUpperCase() },
      });
      toast.success(`Joined ${res.course.title} / ${res.group.title}`);
      navigate(`/courses/${res.course.slug}`);
    } catch (e) {
      // 404 (unknown code) and 410 (disabled) render inline — they're
      // user-input errors, not system failures worth a toast.
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
        setError(e.message);
      } else if (e instanceof ApiError) {
        toast.error(e.message);
      } else {
        toast.error("Could not join. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <PageHeader
        title="Join a course"
        description="Enter the invite code your instructor shared to enroll yourself in a course group."
      />

      <form onSubmit={submit} className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <Label htmlFor="invite-code">Invite code</Label>
          <Input
            id="invite-code"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(prettifyCode(e.target.value))}
            placeholder="ABCD-1234"
            className="mt-1.5 font-mono text-lg tracking-widest uppercase"
            autoComplete="off"
            spellCheck={false}
          />
          {error && (
            <p className="mt-2 text-sm text-rose-500">{error}</p>
          )}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full gradient-bg text-white border-0"
        >
          <Ticket className="size-4 mr-1.5" />
          {submitting ? "Joining…" : "Join course"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Where do I get a code?{" "}
        <span className="text-foreground">Ask your instructor.</span>
      </p>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Already enrolled?{" "}
        <Link to="/courses" className="text-primary hover:underline">
          Go to My Courses
        </Link>
      </p>
    </div>
  );
}
