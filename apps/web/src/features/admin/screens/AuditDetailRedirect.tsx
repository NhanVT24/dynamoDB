"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function AuditDetailRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const query = new URLSearchParams({ tab: "audit", pk: params.get("pk") ?? "", sk: params.get("sk") ?? "" });
    router.replace(`/admin?${query}`);
  }, [router, params]);
  return <p className="p-8" role="status">Opening audit event...</p>;
}
