"use client";

import { useSearchParams } from "next/navigation";
import { ProductsPageClient } from "./products-page-client";

export default function ProductsPage() {
  const searchParams = useSearchParams();
  const category = searchParams.get("category") ?? undefined;
  const sort = searchParams.get("sort") ?? undefined;

  return <ProductsPageClient category={category} sort={sort} />;
}
