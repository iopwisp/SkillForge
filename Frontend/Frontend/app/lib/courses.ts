/**
 * Client-side derivation helpers for the Courses surface.
 *
 * The backend `CourseSummary` shape intentionally omits anything that depends
 * on the viewer (progress, duration estimate, difficulty mix). Per the
 * frontend-overhaul ADR we derive those locally rather than adding new API
 * endpoints. Hard rules from the plan:
 *
 *   - Progress is *only* shown when we can compute it from real data
 *     (intersection of the user's ACCEPTED submission slugs and the course's
 *     `problems[]`). If either side is unavailable we hide the bar.
 *   - Duration is rendered as `~N min` with a tooltip "Estimated" — never
 *     a bare number, never persisted, never invented per-course.
 *   - Difficulty mix counts come directly from `course.problems[].difficulty`.
 *     If the caller doesn't have the detail loaded yet, the mix is omitted.
 *
 * Concurrency: course-detail fetches are throttled to a small parallelism cap
 * so visiting `/courses` with a long enrolment list doesn't fire dozens of
 * requests at once.
 */
import { useEffect, useState } from "react";
import { api } from "./api";
import type { CourseDetail, CourseSummary } from "./teaching-types";
import type { Difficulty, Submission } from "./types";

const MAX_PARALLEL_FETCHES = 4;
/** Rough heuristic: median problem takes ~15 minutes including read-time. */
const MINUTES_PER_PROBLEM = 15;

/**
 * Fetch /submissions/me once per page load and cache the set of slugs the
 * viewer has *accepted*. Returns `null` while loading. If the endpoint fails
 * (e.g. anonymous), returns an empty set so callers degrade gracefully.
 */
export function useAcceptedSlugs(): Set<string> | null {
  const [slugs, setSlugs] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<Submission[]>("/submissions/me")
      .then((rows) => {
        if (cancelled) return;
        const accepted = new Set<string>();
        for (const r of rows) {
          if (r.status === "ACCEPTED" && r.problem?.slug) accepted.add(r.problem.slug);
        }
        setSlugs(accepted);
      })
      .catch(() => {
        if (!cancelled) setSlugs(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return slugs;
}

/**
 * Bulk-fetch /courses/:slug for a list of courses with a parallelism cap.
 * Returns a slug -> detail map. Failed fetches are silently omitted (caller
 * falls back to summary-only rendering).
 */
export function useCourseDetails(
  courses: CourseSummary[] | null,
): Record<string, CourseDetail> {
  const [details, setDetails] = useState<Record<string, CourseDetail>>({});

  useEffect(() => {
    if (!courses || courses.length === 0) return;
    let cancelled = false;
    const queue = courses.map((c) => c.slug);
    const out: Record<string, CourseDetail> = {};

    async function worker() {
      while (!cancelled) {
        const slug = queue.shift();
        if (!slug) return;
        try {
          const detail = await api<CourseDetail>(`/courses/${slug}`);
          if (cancelled) return;
          out[slug] = detail;
          // Push an incremental update so the UI fills in as data arrives.
          setDetails((prev) => ({ ...prev, [slug]: detail }));
        } catch {
          /* swallow — keep degrading gracefully */
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(MAX_PARALLEL_FETCHES, queue.length) },
      () => worker(),
    );
    Promise.all(workers).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses?.map((c) => c.slug).join("|")]);

  return details;
}

/**
 * Combined view-model for a course card. Pure function: pass in the summary,
 * the optional full detail, and the viewer's accepted-slug set, and get back
 * everything the card needs.
 */
export interface CourseViewModel {
  /** Estimated time-to-complete in minutes, derived from problemCount. */
  estimatedMinutes: number;
  /** ≈human-readable estimate ("~3h", "~45 min"). */
  estimatedLabel: string;
  /** True if the card has enough data to show a progress bar. */
  hasProgress: boolean;
  /** 0..1. Only meaningful when `hasProgress` is true. */
  progress: number;
  /** Solved-in-this-course count. Only when `hasProgress` is true. */
  solved: number;
  /** Count of course problems by difficulty. Missing keys = 0. */
  mix: Record<Difficulty, number>;
  /** Total problems counted in `mix`. 0 when no detail loaded. */
  mixTotal: number;
  /** "Start" if no problem in this course has been touched yet, else "Continue". */
  ctaLabel: "Start" | "Continue";
}

export function buildCourseViewModel(
  summary: CourseSummary,
  detail: CourseDetail | undefined,
  acceptedSlugs: Set<string> | null,
): CourseViewModel {
  const estimatedMinutes = summary.problemCount * MINUTES_PER_PROBLEM;
  const estimatedLabel = formatEstimateMinutes(estimatedMinutes);

  const mix: Record<Difficulty, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
  let mixTotal = 0;
  if (detail?.problems) {
    for (const p of detail.problems) {
      mix[p.difficulty] += 1;
      mixTotal += 1;
    }
  }

  let hasProgress = false;
  let solved = 0;
  let ctaLabel: "Start" | "Continue" = "Start";
  if (detail?.problems && acceptedSlugs && summary.problemCount > 0) {
    hasProgress = true;
    for (const p of detail.problems) {
      if (acceptedSlugs.has(p.slug)) solved += 1;
    }
    if (solved > 0) ctaLabel = "Continue";
  }
  const progress = summary.problemCount > 0 ? solved / summary.problemCount : 0;

  return {
    estimatedMinutes,
    estimatedLabel,
    hasProgress,
    progress,
    solved,
    mix,
    mixTotal,
    ctaLabel,
  };
}

/**
 * Render a duration estimate as a short human-readable string. Always
 * prefixed with `~` to signal it's a derived approximation, never persisted.
 */
export function formatEstimateMinutes(minutes: number): string {
  if (minutes <= 0) return "~0 min";
  if (minutes < 60) return `~${minutes} min`;
  const hours = minutes / 60;
  if (hours < 10) return `~${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
  return `~${Math.round(hours)}h`;
}
