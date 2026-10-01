import { Suspense } from "react";
import AuditDetailRedirect from "../../../../src/features/admin/screens/AuditDetailRedirect";

export default function AuditDetailPage() {
  return <Suspense fallback={null}><AuditDetailRedirect /></Suspense>;
}
