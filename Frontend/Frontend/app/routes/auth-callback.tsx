import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { tokens, api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { Logo } from "~/components/brand/Logo";
import type { User } from "~/lib/types";

/**
 * Final destination of the Google OAuth flow.
 * Backend redirects here with ?accessToken=&refreshToken= (or ?error=...).
 */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const [status, setStatus] = useState<"working" | "error">("working");
  const [errorMessage, setErrorMessage] = useState("");
  const next = getSafeNext(params.get("next"));

  useEffect(() => {
    (async () => {
      const error = params.get("error");
      if (error) {
        setStatus("error");
        setErrorMessage(messageForError(error));
        return;
      }
      const access = params.get("accessToken");
      const refresh = params.get("refreshToken");
      if (!access || !refresh) {
        setStatus("error");
        setErrorMessage("Missing tokens from OAuth response.");
        return;
      }
      tokens.set(access, refresh);
      try {
        const me = await api<User>("/auth/me");
        await refreshMe();
        toast.success(`Welcome${me?.username ? `, ${me.username}` : ""}!`);
        navigate(next, { replace: true });
      } catch {
        setStatus("error");
        setErrorMessage("Could not load your account.");
      }
    })();
  }, [next, params, navigate, refreshMe]);

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="text-center max-w-md">
        <Logo className="size-12 mx-auto" />
        <h1 className="mt-6 text-2xl font-semibold">
          {status === "working" ? "Finishing sign-in…" : "Sign-in problem"}
        </h1>
        {status === "working" ? (
          <p className="mt-2 text-muted-foreground">Hang tight while we set up your SkillForge session.</p>
        ) : (
          <>
            <p className="mt-2 text-muted-foreground">{errorMessage}</p>
            <button
              className="mt-6 px-4 py-2 rounded-md bg-primary text-primary-foreground"
              onClick={() => navigate("/login", { replace: true })}
            >
              Back to login
            </button>
          </>
        )}
        {status === "working" && (
          <div className="mt-6 mx-auto h-1 w-32 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 gradient-bg animate-[slide_1.2s_ease-in-out_infinite]" />
          </div>
        )}
        <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
      </div>
    </main>
  );
}

function getSafeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
}

/**
 * Map a backend ?error=... code to a human-readable message.
 *
 * The backend returns generic codes like `oauth_failed`, `invalid_state`,
 * and `domain_not_allowed`. We map them to specific UX text so users can
 * tell apart "your university doesn't accept this account" from
 * "the OAuth flow failed".
 */
function messageForError(code: string): string {
  switch (code) {
    case "domain_not_allowed":
      return "Войти можно только с университетским аккаунтом (@astanait.edu.kz). Проверьте, что вы используете рабочий или учебный Microsoft-аккаунт.";
    case "invalid_state":
      return "Сессия входа истекла. Попробуйте войти ещё раз.";
    case "missing_code":
      return "Microsoft не вернул код авторизации. Попробуйте снова.";
    case "oauth_failed":
      return "Не удалось завершить вход. Попробуйте позже или обратитесь к администратору.";
    default:
      return `Sign-in failed: ${code.replace(/_/g, " ")}`;
  }
}
