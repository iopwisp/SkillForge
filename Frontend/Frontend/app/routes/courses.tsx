/**
 * Student-facing `/courses` page.
 *
 * Overhaul v1 — premium SaaS course catalogue:
 *   - "My courses" with interactive cards, accent bars, progress bars, hover lift.
 *   - "Browse all" with discovery cards and student counts.
 *   - Clean page header, simplified tab styling.
 *
 * All data from existing `/courses` and `/courses/public` APIs.
 * Progress is derived client-side via `lib/courses.ts` — zero backend changes.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  BookOpen,
  Compass,
  Clock,
  Users,
} from "lucide-react";

import { api } from "~/lib/api";
import { ProtectedRoute } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import { LoadingSkeleton } from "~/components/common/LoadingSkeleton";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { CourseDetail, CourseSummary } from "~/lib/teaching-types";
import {
  buildCourseViewModel,
  useAcceptedSlugs,
  useCourseDetails,
} from "~/lib/courses";
import { formatPercent } from "~/lib/format";
import { timeAgo } from "~/lib/format";
import { cn } from "~/components/ui/utils";

interface CourseBrowseItem {
  slug: string;
  title: string;
  description: string | null;
  owner: { id: number; username: string; fullName: string | null };
  groupCount: number;
  studentCount: number;
}

/** Deterministic accent hue from a course slug. 6 preset hues spread across
 *  the colour wheel — keeps cards visually distinct without random colours. */
const ACCENT_HUES = [274, 162, 30, 340, 210, 80];
function accentHue(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = ((hash << 5) - hash + slug.charCodeAt(i)) | 0;
  return ACCENT_HUES[Math.abs(hash) % ACCENT_HUES.length];
}

export default function CoursesPage() {
  return (
    <ProtectedRoute>
      <CoursesContent />
    </ProtectedRoute>
  );
}

function CoursesContent() {
  const [tab, setTab] = useState<"mine" | "browse">("mine");

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Courses</h1>
          <p className="text-sm text-muted-foreground mt-1.5 font-medium">
            Pick up your enrolled courses or browse the catalogue.
          </p>
        </div>

        {/* Underline-style tab bar */}
        <div className="flex items-center gap-1 border-b border-border/60">
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")} icon={BookOpen}>
            My courses
          </TabButton>
          <TabButton active={tab === "browse"} onClick={() => setTab("browse")} icon={Compass}>
            Browse all
          </TabButton>
        </div>

        {tab === "mine" ? <MyCoursesPanel /> : <BrowseCoursesPanel />}
      </div>
    </TooltipProvider>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {children}
      {active && (
        <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
      )}
    </button>
  );
}

/* ─── My courses ────────────────────────────────────────────────────────── */

function MyCoursesPanel() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const acceptedSlugs = useAcceptedSlugs();
  const details = useCourseDetails(courses);

  useEffect(() => {
    api<CourseSummary[]>("/courses")
      .then(setCourses)
      .catch(() => setCourses([]));
  }, []);

  if (!courses) return <LoadingSkeleton rows={3} withHeader={false} />;

  if (courses.length === 0) {
    return (
      <Empty
        icon={BookOpen}
        title="No courses yet"
        description={
          <>
            You haven't been enrolled in any courses. Ask your instructor to
            add you, or have an invite code?{" "}
            <Link to="/join" className="font-semibold text-primary hover:underline">
              Enter code
            </Link>
            .
          </>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-1">
      {courses.map((c) => (
        <MyCourseCard
          key={c.slug}
          course={c}
          detail={details[c.slug]}
          acceptedSlugs={acceptedSlugs}
        />
      ))}
    </div>
  );
}

function MyCourseCard({
  course,
  detail,
  acceptedSlugs,
}: {
  course: CourseSummary;
  detail: CourseDetail | undefined;
  acceptedSlugs: Set<string> | null;
}) {
  const vm = buildCourseViewModel(course, detail, acceptedSlugs);
  const progressPct = formatPercent(vm.progress);

  return (
    <Link
      to={`/courses/${course.slug}`}
      className="group flex flex-col card-interactive accent-bar overflow-hidden"
      style={{ "--accent-hue": accentHue(course.slug) } as React.CSSProperties}
    >
      <div className="p-5 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-[15px] tracking-tight leading-snug line-clamp-2">
              {course.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground inline-flex items-center gap-1">
              <Users className="size-3" />
              <span>@{course.owner.username}</span>
            </p>
          </div>
        </div>

        {/* Mix + meta */}
        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {course.problemCount} problem{course.problemCount === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 cursor-help">
                <Clock className="size-3" />
                {vm.estimatedLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Estimated based on problem count
            </TooltipContent>
          </Tooltip>
          {vm.mixTotal > 0 && (
            <>
              <span aria-hidden>·</span>
              <DifficultyMix mix={vm.mix} total={vm.mixTotal} />
            </>
          )}
        </div>

        {/* Progress */}
        {vm.hasProgress ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium tabular-nums">
                {vm.solved}/{course.problemCount} · {progressPct}
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary progress-fill rounded-full"
                style={{ width: progressPct }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 h-[22px]" aria-hidden />
        )}

        {/* Footer */}
        <div className="mt-5 pt-4 border-t border-border/40 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Updated {timeAgo(course.updatedAt)}
          </span>
          <span
            className={cn(
              "text-xs font-medium px-2.5 py-1 rounded-md transition-colors",
              vm.ctaLabel === "Continue"
                ? "bg-primary text-primary-foreground group-hover:bg-primary/90"
                : "border border-border text-foreground group-hover:bg-accent",
            )}
          >
            {vm.ctaLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}

function DifficultyMix({
  mix,
  total,
}: {
  mix: { EASY: number; MEDIUM: number; HARD: number };
  total: number;
}) {
  const dots = [
    { key: "EASY", count: mix.EASY, color: "bg-emerald-500" },
    { key: "MEDIUM", count: mix.MEDIUM, color: "bg-amber-500" },
    { key: "HARD", count: mix.HARD, color: "bg-rose-500" },
  ];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 cursor-help">
          {dots.map((d) => (
            <span
              key={d.key}
              className={cn(
                "size-1.5 rounded-full",
                d.count > 0 ? d.color : "bg-border",
              )}
              aria-hidden
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {mix.EASY} easy · {mix.MEDIUM} medium · {mix.HARD} hard
        {total !== mix.EASY + mix.MEDIUM + mix.HARD && (
          <> (of {total})</>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/* ─── Browse all ────────────────────────────────────────────────────────── */

function BrowseCoursesPanel() {
  const [courses, setCourses] = useState<CourseBrowseItem[] | null>(null);

  useEffect(() => {
    api<CourseBrowseItem[]>("/courses/public")
      .then(setCourses)
      .catch(() => setCourses([]));
  }, []);

  if (!courses) return <LoadingSkeleton rows={3} withHeader={false} />;

  if (courses.length === 0) {
    return (
      <Empty
        icon={Compass}
        title="No courses in the catalogue"
        description="Once an instructor creates a course, it will appear here."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-1">
      {courses.map((c) => (
        <article
          key={c.slug}
          className="card-interactive accent-bar overflow-hidden flex flex-col"
          style={{ "--accent-hue": accentHue(c.slug) } as React.CSSProperties}
        >
          <div className="p-5 flex-1 flex flex-col">
            <h3 className="font-semibold text-[15px] tracking-tight leading-snug line-clamp-2">
              {c.title}
            </h3>
            {c.description && (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">
                {c.description}
              </p>
            )}
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" /> @{c.owner.username}
              </span>
              <span>
                {c.studentCount} student{c.studentCount === 1 ? "" : "s"}
              </span>
              <span>
                {c.groupCount} group{c.groupCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-auto pt-4 border-t border-border/40 text-[11px] text-muted-foreground">
              Contact <code>@{c.owner.username}</code> for an invite code to join.
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
