"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HomeSections, StorefrontProvider, StorefrontShell } from "./store/store-client";
import { readAuthSession } from "../src/features/auth/lib/cognito-auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const session = readAuthSession();
    if (!session) {
      return;
    }

    if (session.role === "admin") {
      router.replace("/admin");
      return;
    }

    if (session.role === "customer") {
      router.replace("/store");
    }
  }, [router]);

  return (
    <StorefrontProvider>
      <StorefrontShell>
        <HomeSections />
      </StorefrontShell>
    </StorefrontProvider>
  );
}
