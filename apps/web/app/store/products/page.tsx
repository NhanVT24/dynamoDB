"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { ProductsPageClient } from "./products-page-client";

function ProductsPageContent() {
  const searchParams = useSearchParams();
  const category = searchParams.get("category") ?? undefined;
  const sort = searchParams.get("sort") ?? undefined;

  return <ProductsPageClient category={category} sort={sort} />;
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageContent />
    </Suspense>
  );
}
