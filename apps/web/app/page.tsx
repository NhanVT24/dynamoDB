"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HomeSections, StorefrontProvider, StorefrontShell } from "./store/store-client";
import { readAuthSession } from "../src/features/auth/lib/cognito-auth";

export default function HomePage() {
  const router = useRouter();
  const [isResolvingSession, setIsResolvingSession] = useState(true);

  useEffect(() => {
    const session = readAuthSession();
    if (!session) {
      setIsResolvingSession(false);
      return;
    }

    if (session.role === "admin") {
      router.replace("/admin");
      return;
    }

    if (session.role === "customer") {
      router.replace("/store");
      return;
    }

    setIsResolvingSession(false);
  }, [router]);

  if (isResolvingSession) {
    return null;
  }

  return (
    <StorefrontProvider>
      <StorefrontShell>
        <HomeSections />
      </StorefrontShell>
    </StorefrontProvider>
  );
}
