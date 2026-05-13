import { Navigate } from "react-router";
import { RoleGuard } from "~/lib/guards";

/**
 * `/teach` simply redirects to the courses dashboard. Putting the redirect
 * behind the role guard means STUDENTs land on the access-denied page,
 * not on the course list page that would 401 on its first request.
 */
export default function TeachIndex() {
  return (
    <RoleGuard allowed={["INSTRUCTOR", "ADMIN"]}>
      <Navigate to="/teach/courses" replace />
    </RoleGuard>
  );
}
