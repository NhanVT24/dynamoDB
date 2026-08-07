"use client";

import { storeCategories } from "./store-data";
import type { StoreProduct } from "./store-types";

type StorefrontApiItem = {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  stock?: number;
  price?: number;
  originalPrice?: number;
  description?: string;
  sku?: string;
  status?: "active" | "low_stock" | "out_of_stock";
  updatedAt?: string;
  createdAt?: string;
  imageUrl?: string;
  soldCount?: number;
};

type StorefrontListResponse = {
  items?: StorefrontApiItem[];
  nextCursor?: string | null;
  hasNextPage?: boolean;
};

const publicApiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

function getStorefrontBasePath() {
  if (!publicApiBaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_API_URL in apps/web environment.");
  }

  return `${publicApiBaseUrl}/api/products`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getCategoryImage(category: string) {
  return storeCategories.find((item) => item.label === category)?.imageUrl ?? storeCategories[0]?.imageUrl ?? "";
}

function getCategorySpecs(category: string, brand: string) {
  return [
    `${brand} Edition`,
    category,
    "Bảo hành chính hãng"
  ];
}

export function toStoreProduct(item: StorefrontApiItem): StoreProduct {
  const category = item.category ?? "Điện tử";
  const brand = item.brand?.trim() || "NovaX";
  const name = item.name?.trim() || "Sản phẩm";
  const price = Number(item.price ?? 0);
  const originalPrice = Number(item.originalPrice ?? Math.max(price, price + Math.round(price * 0.12)));
  const stock = Number(item.stock ?? 0);
  const status =
    item.status ??
    (stock <= 0 ? "out_of_stock" : stock <= 10 ? "low_stock" : "active");

  return {
    id: item.id,
    slug: slugify(`${name}-${brand}-${item.id}`),
    name,
    category,
    brand,
    sku: item.sku?.trim() || item.id,
    stock,
    price,
    originalPrice,
    status,
    rating: 4.8,
    soldCount: Number(item.soldCount ?? 0),
    featured: true,
    description: item.description?.trim() || "Sản phẩm đang được cập nhật mô tả chi tiết.",
    imageUrl: item.imageUrl?.trim() || getCategoryImage(category),
    location: "Việt Nam",
    updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
    badge: status === "out_of_stock" ? "Hết hàng" : stock <= 10 ? "Sắp hết" : "Mới cập nhật",
    specs: getCategorySpecs(category, brand)
  };
}

export async function fetchStorefrontProducts(query: Record<string, string> = {}) {
  const params = new URLSearchParams({ limit: "50", ...query });
  const response = await fetch(`${getStorefrontBasePath()}?${params.toString()}`, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Không thể tải dữ liệu sản phẩm.");
  }

  const payload = (await response.json()) as StorefrontListResponse;
  return (payload.items ?? []).map(toStoreProduct);
}
