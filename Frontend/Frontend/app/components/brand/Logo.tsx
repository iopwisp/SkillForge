import { cn } from "~/components/ui/utils";

/**
 * SkillForge mark — abstract mammoth tusk forming a stylised "T" with a pixel notch,
 * sitting in a softly rounded gradient tile. Distinct from any LeetCode iconography.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center rounded-lg gradient-bg shadow-md shadow-primary/20", className)}>
      <svg
        viewBox="0 0 24 24"
        className="w-[68%] h-[68%] text-white"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        {/* Tusk curve */}
        <path
          d="M5 4 C 13 4, 18 9, 18 16 C 18 19, 16 21, 13 21 L 11.5 21 L 11.5 17 C 14 17, 14 14, 12 13 C 9 11, 7 9.5, 7 7 L 5 4 Z"
          fill="currentColor"
          opacity="0.95"
        />
        {/* Pixel notch (the "hub" cell) */}
        <rect x="14" y="6" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.6" />
        {/* Crossbar of T */}
        <path d="M3 5 H 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
