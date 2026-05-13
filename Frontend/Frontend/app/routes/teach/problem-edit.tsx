import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { api, ApiError } from "~/lib/api";
import { Loading, RoleGuard } from "~/lib/guards";
import { ProblemForm, fromEditor, type ProblemFormState } from "~/components/teach/ProblemForm";
import { Empty } from "~/components/common/Empty";
import { FileQuestion } from "lucide-react";
import type { ProblemEditorDetail } from "~/lib/teaching-types";

export default function ProblemEditPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<ProblemFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    api<ProblemEditorDetail>(`/problems/${slug}/edit`)
      .then((d) => setInitial(fromEditor(d)))
      .catch((e: any) => setError(e instanceof ApiError ? e.message : "Could not load problem"));
  }, [slug]);

  if (error) {
    return (
      <Empty
        icon={FileQuestion}
        title="Problem not available"
        description={error}
      />
    );
  }
  if (!initial || !slug) return <Loading />;

  return (
    <ProblemForm
      title={`Edit · ${slug}`}
      slugEditable={false}
      initial={initial}
      submitLabel="Save changes"
      onSubmit={async (payload) => {
        // Slug must not change on edit; backend ignores it on PUT but we
        // strip it to be tidy. The category is required on PUT because
        // the merged validator re-runs against the full schema.
        const { slug: _drop, ...rest } = payload;
        await api(`/problems/${slug}`, { method: "PUT", body: rest });
        toast.success("Saved changes");
        navigate("/teach/problems", { replace: true });
      }}
    />
  );
}
