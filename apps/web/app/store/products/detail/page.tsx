"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { ProductDetailClient } from "../../store-client";

function ProductDetailContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const querySlug = searchParams.get("slug") ?? "";
  const pathSlug = pathname.startsWith("/store/products/") && !pathname.startsWith("/store/products/detail")
    ? decodeURIComponent(pathname.replace(/^\/store\/products\/?/, "").replace(/\/+$/, ""))
    : "";
  const slug = querySlug || pathSlug;

  return <ProductDetailClient slug={slug} />;
}

export default function ProductDetailPage() {
  return (
    <Suspense fallback={null}>
      <ProductDetailContent />
    </Suspense>
  );
}
