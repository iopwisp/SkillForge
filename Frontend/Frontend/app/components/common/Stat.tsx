import type { ReactNode, ComponentType } from "react";
import { cn } from "~/components/ui/utils";

/**
 * Neutral stat tile used by Dashboard / Profile / Problems.
 *
 * Monochrome by default; optional `icon` renders a small muted icon top-left.
 * Uses `card-interactive` for consistent hover lift when placed in a
 * clickable context. Numbers are tabular for column alignment.
 */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  className,
  emphasise = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
  /** Slightly larger value for hero stats. */
  emphasise?: boolean;
}) {
  return (
    <div
      className={cn(
        "card-interactive px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "mt-1 font-bold tabular-nums tracking-tight text-foreground",
          emphasise ? "text-3xl" : "text-2xl",
        )}
      >
        {value}
      </div>
      {hint !== undefined && (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
