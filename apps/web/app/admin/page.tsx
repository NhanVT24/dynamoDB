import { Suspense } from "react";

import AdminConsole from "../../src/features/admin/screens/AdminConsole";

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminConsole />
    </Suspense>
  );
}
