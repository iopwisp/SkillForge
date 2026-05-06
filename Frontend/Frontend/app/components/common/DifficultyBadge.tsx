import { cn } from "~/components/ui/utils";

const styles = {
  EASY:   "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  MEDIUM: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  HARD:   "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

const labels = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" };

export function DifficultyBadge({
  difficulty,
  className,
}: {
  difficulty: "EASY" | "MEDIUM" | "HARD";
  className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium",
      styles[difficulty],
      className,
    )}>
      {labels[difficulty]}
    </span>
  );
}
