import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BookOpen, Users, ChevronRight } from "lucide-react";
import { api } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import type { CourseSummary } from "~/lib/teaching-types";
import { timeAgo } from "~/lib/format";

export default function CoursesPage() {
  return (
    <ProtectedRoute>
      <CoursesContent />
    </ProtectedRoute>
  );
}

function CoursesContent() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);

  useEffect(() => {
    api<CourseSummary[]>("/courses").then(setCourses).catch(() => setCourses([]));
  }, []);

  if (!courses) return <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Courses</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Courses you are enrolled in
        </p>
      </div>

      {courses.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="No courses yet"
          description="You haven't been enrolled in any courses. Ask your instructor to add you to a group."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.slug}
              to={`/courses/${c.slug}`}
              className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <BookOpen className="size-5 text-primary" />
                </div>
                <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
              </div>
              <h3 className="mt-3 font-semibold text-lg">{c.title}</h3>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-3" /> {c.owner.username}
                </span>
                <span>{c.problemCount} problems</span>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                Updated {timeAgo(c.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
