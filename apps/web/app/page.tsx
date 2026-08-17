"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readAuthSession } from "../src/features/auth/lib/cognito-auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const session = readAuthSession();

    if (session?.role === "admin") {
      router.replace("/admin");
      return;
    }

    router.replace("/store");
  }, [router]);

  return null;
}
