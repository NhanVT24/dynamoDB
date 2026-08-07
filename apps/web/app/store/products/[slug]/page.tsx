"use client";

import { useParams } from "next/navigation";
import { ProductDetailClient } from "../../store-client";

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";

  return <ProductDetailClient slug={slug} />;
}
