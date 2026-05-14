/**
 * Student-facing `/courses` page.
 *
 * Two tabs:
 *   - "My courses" — the existing behaviour (enrolled courses only,
 *     backend `GET /api/courses` already narrows for STUDENT actors per
 *     ADR 0008).
 *   - "Browse all" — discovery list backed by `GET /api/courses/public`,
 *     which returns every course in the installation with a limited
 *     shape (no syllabus). Intentionally has no "Join" button — the
 *     current academic model requires owner consent (invite code or
 *     manual add), so the card shows the owner handle instead.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BookOpen, Users, ChevronRight, Compass } from "lucide-react";
import { api } from "~/lib/api";
import { ProtectedRoute, Loading } from "~/lib/guards";
import { Empty } from "~/components/common/Empty";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "~/components/ui/tabs";
import type { CourseSummary } from "~/lib/teaching-types";
import { timeAgo } from "~/lib/format";

interface CourseBrowseItem {
  slug: string;
  title: string;
  description: string | null;
  owner: { id: number; username: string; fullName: string | null };
  groupCount: number;
  studentCount: number;
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Courses</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse the catalog or jump into a course you're already enrolled in.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "mine" | "browse")}>
        <TabsList className="mb-5">
          <TabsTrigger value="mine">
            <BookOpen className="size-4 mr-1.5" /> My courses
          </TabsTrigger>
          <TabsTrigger value="browse">
            <Compass className="size-4 mr-1.5" /> Browse all
          </TabsTrigger>
        </TabsList>
        <TabsContent value="mine">
          <MyCoursesPanel />
        </TabsContent>
        <TabsContent value="browse">
          <BrowseCoursesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MyCoursesPanel() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);

  useEffect(() => {
    api<CourseSummary[]>("/courses").then(setCourses).catch(() => setCourses([]));
  }, []);

  if (!courses) return <Loading />;

  if (courses.length === 0) {
    return (
      <Empty
        icon={BookOpen}
        title="No courses yet"
        description={
          <>
            You haven't been enrolled in any courses. Ask your instructor to add you,
            or have an invite code?{" "}
            <Link to="/join" className="font-semibold text-primary hover:underline">
              Enter code
            </Link>.
          </>
        }
      />
    );
  }

  return (
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
  );
}

function BrowseCoursesPanel() {
  const [courses, setCourses] = useState<CourseBrowseItem[] | null>(null);

  useEffect(() => {
    api<CourseBrowseItem[]>("/courses/public")
      .then(setCourses)
      .catch(() => setCourses([]));
  }, []);

  if (!courses) return <Loading />;

  if (courses.length === 0) {
    return (
      <Empty
        icon={Compass}
        title="No courses in the catalog"
        description="Once an instructor creates a course, it will appear here."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((c) => (
        <article
          key={c.slug}
          className="rounded-xl border border-border bg-card p-5 flex flex-col"
        >
          <div className="flex items-start justify-between">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <BookOpen className="size-5 text-primary" />
            </div>
          </div>
          <h3 className="mt-3 font-semibold text-lg leading-tight">{c.title}</h3>
          {c.description && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">
              {c.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="size-3" /> @{c.owner.username}
            </span>
            <span>{c.groupCount} group{c.groupCount === 1 ? "" : "s"}</span>
            <span>{c.studentCount} student{c.studentCount === 1 ? "" : "s"}</span>
          </div>
          <p className="mt-auto pt-3 text-[11px] text-muted-foreground">
            Contact <code>@{c.owner.username}</code> for an invite code to join.
          </p>
        </article>
      ))}
    </div>
  );
}
