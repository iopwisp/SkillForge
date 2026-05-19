export function timeAgo(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date.replace(" ", "T") + "Z") : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date.replace(" ", "T") + "Z") : date;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

/** Render a 0..1 ratio as an integer percentage, clamping out-of-range values. */
export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "0%";
  const clamped = Math.max(0, Math.min(1, ratio));
  return `${(clamped * 100).toFixed(digits).replace(/\.0+$/, "")}%`;
}

export function difficultyColor(d: string) {
  switch (d) {
    case "EASY":   return "text-emerald-500";
    case "MEDIUM": return "text-amber-500";
    case "HARD":   return "text-rose-500";
    default:       return "text-muted-foreground";
  }
}

export function statusColor(s: string) {
  switch (s) {
    case "ACCEPTED":      return "text-emerald-500";
    case "WRONG_ANSWER":  return "text-rose-500";
    case "TLE":           return "text-amber-500";
    case "RUNTIME_ERROR": return "text-orange-500";
    case "COMPILE_ERROR": return "text-rose-500";
    case "JUDGE_ERROR":   return "text-rose-500";
    case "PENDING":       return "text-muted-foreground";
    default:              return "text-muted-foreground";
  }
}

export function statusLabel(s: string) {
  switch (s) {
    case "ACCEPTED":      return "Accepted";
    case "WRONG_ANSWER":  return "Wrong Answer";
    case "TLE":           return "Time Limit Exceeded";
    case "RUNTIME_ERROR": return "Runtime Error";
    case "COMPILE_ERROR": return "Compile Error";
    case "JUDGE_ERROR":   return "Judge Error";
    case "PENDING":       return "Pending";
    default:              return s;
  }
}
