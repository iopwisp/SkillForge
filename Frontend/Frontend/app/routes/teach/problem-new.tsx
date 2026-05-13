import { useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "~/lib/api";
import { RoleGuard } from "~/lib/guards";
import { ProblemForm, emptyFormState } from "~/components/teach/ProblemForm";

export default function ProblemNewPage() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Inner />
    </RoleGuard>
  );
}

function Inner() {
  const navigate = useNavigate();
  return (
    <ProblemForm
      title="New problem"
      slugEditable
      initial={emptyFormState()}
      submitLabel="Create problem"
      onSubmit={async (payload) => {
        await api(`/problems`, { method: "POST", body: payload });
        toast.success(`Created "${payload.title}"`);
        navigate("/teach/problems", { replace: true });
      }}
    />
  );
}
