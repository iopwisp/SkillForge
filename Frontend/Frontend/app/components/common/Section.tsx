import type { ReactNode } from "react";
import { cn } from "~/components/ui/utils";

/**
 * Standardised content card with a header row (title + optional action).
 *
 * Replaces the ad-hoc `<div className="rounded-xl border bg-card p-5">…</div>`
 * scaffolding that was duplicated across dashboard / profile / courses.
 * Spacing and divider weights are pulled from design tokens so the visual
 * language is consistent across pages.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  /** Render with no inner padding — caller owns the body layout. */
  bare = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  bare?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/60 bg-card shadow-sm",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/60">
          <div className="min-w-0">
            {title && <h2 className="section-title truncate">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn(!bare && "p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
