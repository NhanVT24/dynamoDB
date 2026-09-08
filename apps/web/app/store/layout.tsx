import { Suspense, type ReactNode } from "react";
import { StorefrontProvider, StorefrontShell } from "./store-client";

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontProvider>
      <Suspense fallback={<p role="status" className="p-6">Loading store...</p>}>
        <StorefrontShell>{children}</StorefrontShell>
      </Suspense>
    </StorefrontProvider>
  );
}
