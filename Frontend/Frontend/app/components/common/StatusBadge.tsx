import { Check, X, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "~/components/ui/utils";

const styles: Record<string, string> = {
  ACCEPTED:      "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  WRONG_ANSWER:  "bg-rose-500/10 text-rose-500 border-rose-500/20",
  TLE:           "bg-amber-500/10 text-amber-500 border-amber-500/20",
  RUNTIME_ERROR: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  COMPILE_ERROR: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  JUDGE_ERROR:   "bg-rose-500/10 text-rose-500 border-rose-500/20",
  PENDING:       "bg-muted text-muted-foreground border-border",
};

const labels: Record<string, string> = {
  ACCEPTED: "Accepted",
  WRONG_ANSWER: "Wrong Answer",
  TLE: "Time Limit Exceeded",
  RUNTIME_ERROR: "Runtime Error",
  COMPILE_ERROR: "Compile Error",
  JUDGE_ERROR: "Judge Error",
  PENDING: "Judging…",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const Icon =
    status === "ACCEPTED" ? Check :
    status === "PENDING" ? Loader2 :
    status === "TLE" ? Clock :
    status === "RUNTIME_ERROR" || status === "JUDGE_ERROR" ? AlertTriangle :
    X;

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium",
      styles[status] || styles.PENDING,
      className,
    )}>
      <Icon className={cn("size-3", status === "PENDING" && "animate-spin")} />
      {labels[status] || status}
    </span>
  );
}
