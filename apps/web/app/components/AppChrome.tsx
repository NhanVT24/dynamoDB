"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

type AppChromeProps = {
  children: ReactNode;
};

export function AppChrome({ children }: AppChromeProps) {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith("/admin");

  if (!isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <main
      className="mx-auto w-full max-w-[1440px] px-4 py-3 md:px-5 md:py-4"
      style={{
        width: "100%",
        maxWidth: "1440px",
        margin: "0 auto",
        padding: "12px 20px 16px"
      }}
    >
      {children}
    </main>
  );
}
