import type { ReactNode } from "react";

/**
 * Consistent page header — title + optional subtitle + optional action slot.
 * Used at the top of every non-workspace page for uniform hierarchy.
 *
 * Typography: `text-2xl lg:text-3xl font-semibold` (not bold — calmer SaaS feel).
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 lg:mb-8">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground font-medium">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
