import { Navigate } from "react-router";
import { RoleGuard } from "~/lib/guards";

export default function AdminIndex() {
  return (
    <RoleGuard allowed={["ADMIN"]}>
      <Navigate to="/admin/audit-log" replace />
    </RoleGuard>
  );
}
