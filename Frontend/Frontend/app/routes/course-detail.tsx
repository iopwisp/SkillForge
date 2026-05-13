import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft, BookOpen, Clock, Timer, Users, CalendarClock, CheckCircle2,
  AlertCircle, Lock, PlayCircle,
} from "lucide-react";
import { api, ApiError } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import type { CourseDetail } from "~/lib/teaching-types";
import type { ExamSummary } from "~/lib/teaching-types";
import { Button } from "~/components/ui/button";
import { DifficultyBadge } from "~/components/common/DifficultyBadge";
import { formatDateTime, timeAgo } from "~/lib/format";

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 mb-3">
          <Link to="/courses"><ArrowLeft className="size-4 mr-1" /> Courses</Link>
        </Button>
        <h1 className="text-2xl font-bold">{course.title}</h1>
        {course.description && (
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{course.description}</p>
        )}
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="size-3" /> {course.owner.username}
          </span>
          <span>{course.problemCount} problems</span>
        </div>
      </div>

      {/* Exams */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <CalendarClock className="size-5 text-primary" /> Exams
        </h2>
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
      </section>

      {/* Course problems (practice) */}
      {course.problems.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="size-5 text-primary" /> Course Problems
          </h2>
          <div className="rounded-xl border border-border divide-y divide-border">
            {course.problems.map((p) => (
              <Link
                key={p.slug}
                to={`/problems/${p.slug}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors"
              >
                <span className="font-medium text-sm flex-1">{p.title}</span>
                <DifficultyBadge difficulty={p.difficulty} />
              </Link>
            ))}
          </div>
        </section>
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
      className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
    >
      <div className={`rounded-lg p-2.5 ${style.bg}`}>
        <StatusIcon className={`size-5 ${style.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
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
