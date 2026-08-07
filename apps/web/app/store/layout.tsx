import type { ReactNode } from "react";
import { StorefrontProvider, StorefrontShell } from "./store-client";

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontProvider>
      <StorefrontShell>{children}</StorefrontShell>
    </StorefrontProvider>
  );
}
