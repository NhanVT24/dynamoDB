"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { ProductDetailClient } from "../../store-client";

function ProductDetailContent() {
  const searchParams = useSearchParams();
  const slug = searchParams.get("slug") ?? "";

  return <ProductDetailClient slug={slug} />;
}

export default function ProductDetailPage() {
  return (
    <Suspense fallback={null}>
      <ProductDetailContent />
    </Suspense>
  );
}
