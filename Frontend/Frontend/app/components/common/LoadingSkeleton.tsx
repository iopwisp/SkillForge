import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/components/ui/utils";

/**
 * Generic page-level skeleton: a header row + N body rows.
 * Used in place of "Loading…" plain-text fallbacks so layout doesn't reflow
 * on data arrival. Pages with bespoke layouts (problem-detail, exam) keep
 * their own skeletons.
 */
export function LoadingSkeleton({
  rows = 5,
  withHeader = true,
  className,
}: {
  rows?: number;
  withHeader?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      {withHeader && (
        <div className="space-y-2">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-[var(--radius)]" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-[var(--radius)]" />
        ))}
      </div>
    </div>
  );
}
