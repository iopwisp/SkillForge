import { cn } from "~/components/ui/utils";

/**
 * SkillForge mark — abstract mammoth tusk forming a stylised "T" with a pixel notch,
 * sitting in a softly rounded gradient tile. Distinct from any LeetCode iconography.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center rounded-lg gradient-bg shadow-md shadow-primary/20", className)}>
      <svg
        viewBox="0 0 100 100"
        className="w-[70%] h-[70%] text-white animate-fade-in"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        {/* Anvil shape */}
        <path
          d="M 16,40 L 74,40 L 74,48 C 62,48 55,50 55,56 C 55,62 60,66 68,68 C 72,68 74,70 74,74 L 74,76 L 26,76 L 26,74 C 26,70 28,68 32,68 C 40,66 45,62 45,56 C 45,50 38,48 16,42 Z"
        />
        {/* Sparkle / Four-pointed star */}
        <path
          d="M 52,14 Q 52,22 44,22 Q 52,22 52,30 Q 52,22 60,22 Q 52,22 52,14 Z"
        />
      </svg>
    </span>
  );
}
