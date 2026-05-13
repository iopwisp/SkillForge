import { Navigate, useLocation, Link } from "react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "./auth";
import { Logo } from "~/components/brand/Logo";
import type { Role } from "./types";
import { Empty } from "~/components/common/Empty";
import { Button } from "~/components/ui/button";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) {
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/**
 * Wraps a tree behind both auth AND a role check. The check mirrors the
 * server-side `requireRole(...allowed)` middleware so unauthorised users
 * see a friendly "no access" page instead of a confusing 403 from a
 * subsequent API call.
 *
 * Backend is still the source of truth — this guard exists for UX only.
 */
export function RoleGuard({
  allowed,
  children,
}: {
  allowed: Role[];
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <RoleGuardInner allowed={allowed}>{children}</RoleGuardInner>
    </ProtectedRoute>
  );
}

function RoleGuardInner({ allowed, children }: { allowed: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!allowed.includes(user.role)) return <NoAccess allowed={allowed} />;
  return <>{children}</>;
}

function NoAccess({ allowed }: { allowed: Role[] }) {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-10">
      <Empty
        icon={ShieldAlert}
        title="You don't have access to this page"
        description={
          <>
            This area is reserved for{" "}
            <span className="font-medium">{allowed.join(" / ")}</span>. If you believe this is a
            mistake, ask an admin to grant you the correct role.
          </>
        }
        action={<Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>}
      />
    </div>
  );
}

export function Loading() {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Logo className="size-10 animate-pulse" />
        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 gradient-bg animate-[slide_1.2s_ease-in-out_infinite]" />
        </div>
        <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
      </div>
    </div>
  );
}
