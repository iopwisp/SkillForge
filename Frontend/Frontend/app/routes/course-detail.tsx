/**
 * Course detail page — `/courses/:slug`.
 *
 * Overhaul v1:
 *   - Header with accent-bar gradient mesh (same approach as profile/dashboard).
 *   - Progress bar uses `progress-fill` animation.
 *   - Problem list uses `row-accent-left` for solved items.
 *   - Exam cards use `card-interactive` with status indicators.
 */
import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, Clock, Timer, Users, CalendarClock, CheckCircle2,
  AlertCircle, Lock, PlayCircle, Check,
} from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import { Section } from "~/components/common/Section";
import type { CourseDetail } from "~/lib/teaching-types";
import type { ExamSummary } from "~/lib/teaching-types";
import { Button } from "~/components/ui/button";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { formatDateTime, formatPercent, timeAgo } from "~/lib/format";
import {
  buildCourseViewModel,
  useAcceptedSlugs,
  formatEstimateMinutes,
} from "~/lib/courses";
import { cn } from "~/components/ui/utils";

export default function CourseDetailPage() {
  return (
    <ProtectedRoute>
      <CourseDetailContent />
    </ProtectedRoute>
  );
}

function CourseDetailContent() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const acceptedSlugs = useAcceptedSlugs();

  useEffect(() => {
    api<CourseDetail>(`/courses/${slug}`)
      .then(setCourse)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) navigate("/courses", { replace: true });
        else toast.error("Failed to load course");
      });
    api<ExamSummary[]>(`/courses/${slug}/exams`)
      .then(setExams)
      .catch(() => setExams([]));
  }, [slug, navigate]);

  if (!course) return <Loading />;

  // Build the same view-model used by the courses listing, so the header here
  // stays in sync with the card. Same data-integrity rules apply: progress
  // hidden when not derivable, duration always prefixed with "~".
  const vm = buildCourseViewModel(course, course, acceptedSlugs);
  const estimateLabel = formatEstimateMinutes(vm.estimatedMinutes);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="relative overflow-hidden rounded-[var(--radius)] border border-border-subtle bg-card shadow-[var(--shadow-sm)]">
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 20% 50%, var(--brand-indigo), transparent), " +
              "radial-gradient(ellipse 60% 50% at 80% 30%, var(--brand-violet), transparent)",
          }}
          aria-hidden
        />
        <div className="relative p-5 sm:p-6">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 mb-3">
            <Link to="/courses"><ArrowLeft className="size-4 mr-1" /> Courses</Link>
          </Button>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{course.title}</h1>
          {course.description && (
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl whitespace-pre-line">{course.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" /> @{course.owner.username}
            </span>
            <span>{course.problemCount} problems</span>
            <span title="Estimated based on problem count" className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {estimateLabel}
            </span>
          </div>
          {vm.hasProgress && (
            <div className="mt-4 max-w-md">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium tabular-nums">
                  {vm.solved}/{course.problemCount} · {formatPercent(vm.progress)}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary progress-fill rounded-full"
                  style={{ width: formatPercent(vm.progress) }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Exams */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" /> Exams
          </span>
        }
      >
        {exams === null ? (
          <Loading />
        ) : exams.length === 0 ? (
          <Empty
            icon={CalendarClock}
            title="No exams"
            description="No exams have been scheduled for this course yet."
          />
        ) : (
          <div className="space-y-3">
            {exams.map((exam) => (
              <ExamCard key={exam.slug} courseSlug={slug} exam={exam} />
            ))}
          </div>
        )}
      </Section>

      {/* Course problems (practice) */}
      {course.problems.length > 0 && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" /> Course Problems
            </span>
          }
        >
          <div className="rounded-[var(--radius)] border border-border-subtle overflow-hidden">
            <ul className="divide-y divide-border-subtle">
              {course.problems.map((p) => {
                const solved = acceptedSlugs?.has(p.slug) ?? false;
                return (
                  <li
                    key={p.slug}
                    className="row-accent-left"
                    data-status={solved ? "solved" : undefined}
                  >
                    <Link
                      to={`/problems/${p.slug}`}
                      className="flex items-center gap-3 px-4 py-3 text-sm"
                    >
                      <span className={cn(
                        "size-5 rounded-full flex items-center justify-center shrink-0",
                        solved
                          ? "bg-emerald-500 text-white"
                          : "border border-border text-muted-foreground",
                      )}>
                        {solved && <Check className="size-3" />}
                      </span>
                      <span className="font-medium flex-1 truncate">{p.title}</span>
                      <DifficultyBadge difficulty={p.difficulty} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </Section>
      )}
    </div>
  );
}

type ExamStatus = "upcoming" | "open" | "closed";

function examStatus(exam: ExamSummary): ExamStatus {
  const now = Date.now();
  if (now < new Date(exam.startsAt).getTime()) return "upcoming";
  if (now >= new Date(exam.endsAt).getTime()) return "closed";
  return "open";
}

const STATUS_STYLE: Record<ExamStatus, { bg: string; text: string; icon: typeof Clock; label: string }> = {
  upcoming: { bg: "bg-blue-500/10", text: "text-blue-500", icon: Lock, label: "Upcoming" },
  open:     { bg: "bg-emerald-500/10", text: "text-emerald-500", icon: PlayCircle, label: "Open" },
  closed:   { bg: "bg-muted", text: "text-muted-foreground", icon: CheckCircle2, label: "Closed" },
};

function ExamCard({ courseSlug, exam }: { courseSlug: string; exam: ExamSummary }) {
  const status = examStatus(exam);
  const style = STATUS_STYLE[status];
  const StatusIcon = style.icon;

  return (
    <Link
      to={`/courses/${courseSlug}/exams/${exam.slug}`}
      className="flex items-center gap-4 card-interactive p-4"
    >
      <div className={`rounded-lg p-2.5 ${style.bg}`}>
        <StatusIcon className={`size-5 ${style.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold truncate">{exam.title}</h3>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}>
            {style.label}
          </span>
          {exam.groupSlug && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {exam.groupSlug}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3" />
            {formatDateTime(exam.startsAt)} — {formatDateTime(exam.endsAt)}
          </span>
          <span className="flex items-center gap-1">
            <Timer className="size-3" /> {exam.durationMinutes} min
          </span>
          <span>{exam.problemCount} problems</span>
        </div>
      </div>
    </Link>
  );
}
