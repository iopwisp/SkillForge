import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Full-width empty-state placeholder. Used when a list has zero items.
 * Premium feel: larger icon container, generous padding, subtle dashed border.
 */
export function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 rounded-[var(--radius)] border border-dashed border-border bg-card/40">
      {Icon && (
        <div className="size-14 rounded-xl bg-primary/8 text-primary flex items-center justify-center mb-5">
          <Icon className="size-6" />
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-muted-foreground max-w-md">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
