"use client";

import { readAuthSession } from "../lib/cognito-auth";
import { storeCategories } from "./store-data";
import type { StoreOrder, StoreProduct } from "./store-types";

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
  location?: string;
  featured?: boolean;
  rating?: number;
  isLocked?: boolean;
  lockedUntil?: string;
  attributes?: Record<string, unknown>;
};

type StorefrontListResponse = {
  items?: StorefrontApiItem[];
  pageInfo?: {
    nextCursor?: string | null;
    hasNextPage?: boolean;
    limit?: number;
    cursor?: string | null;
  };
};

type StorefrontOrderApiItem = {
  id: string;
  customerEmail: string;
  status: string;
  items?: Array<{
    productId: string;
    productName: string;
    price: number;
    quantity: number;
    lineTotal: number;
  }>;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
};

const publicApiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

function getStorefrontBasePath() {
  if (!publicApiBaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_API_URL in apps/web environment.");
  }

  return `${publicApiBaseUrl}/api/storefront`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getCategoryImage(category: string) {
  return storeCategories.find((item) => item.label === category)?.imageUrl ?? storeCategories[0]?.imageUrl ?? "";
}

function getCategorySpecs(category: string, brand: string, attributes?: Record<string, unknown>) {
  const baseSpecs = [
    `${brand} Edition`,
    category,
    "Bao hanh chinh hang"
  ];

  const attributeSpecs = Object.entries(attributes ?? {})
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return [...baseSpecs, ...attributeSpecs];
}

export function toStoreProduct(item: StorefrontApiItem): StoreProduct {
  const category = item.category ?? "Dien tu";
  const brand = item.brand?.trim() || "NovaX";
  const name = item.name?.trim() || "San pham";
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
    rating: Number(item.rating ?? 4.8),
    soldCount: Number(item.soldCount ?? 0),
    featured: Boolean(item.featured ?? true),
    description: item.description?.trim() || "San pham dang duoc cap nhat mo ta chi tiet.",
    imageUrl: item.imageUrl?.trim() || getCategoryImage(category),
    location: item.location?.trim() || "Viet Nam",
    updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
    isLocked: Boolean(item.isLocked),
    lockedUntil: item.lockedUntil,
    badge: status === "out_of_stock" ? "Het hang" : item.isLocked ? "Dang duoc giu" : stock <= 10 ? "Sap het" : "Moi cap nhat",
    specs: getCategorySpecs(category, brand, item.attributes)
  };
}

export async function fetchStorefrontProducts(query: Record<string, string> = {}) {
  const pageLimit = query.limit ?? "48";
  const aggregatedItems: StorefrontApiItem[] = [];
  let nextCursor: string | null = null;
  let hasNextPage = true;
  let lastPayload: StorefrontListResponse | null = null;

  while (hasNextPage) {
    const params = new URLSearchParams({ limit: pageLimit, ...query });
    if (nextCursor) {
      params.set("cursor", nextCursor);
    }

    const response = await fetch(`${getStorefrontBasePath()}/products?${params.toString()}`, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Khong the tai du lieu san pham.");
    }

    const payload = (await response.json()) as StorefrontListResponse;
    aggregatedItems.push(...(payload.items ?? []));
    lastPayload = payload;
    nextCursor = payload.pageInfo?.nextCursor ?? null;
    hasNextPage = Boolean(payload.pageInfo?.hasNextPage && nextCursor);
  }

  return {
    items: aggregatedItems.map(toStoreProduct),
    pageInfo: {
      nextCursor: lastPayload?.pageInfo?.nextCursor ?? null,
      hasNextPage: false,
      limit: aggregatedItems.length,
      cursor: null
    }
  };
}

export async function fetchStorefrontProductById(id: string) {
  const response = await fetch(`${getStorefrontBasePath()}/products/${id}`, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Khong the tai chi tiet san pham.");
  }

  const payload = (await response.json()) as StorefrontApiItem;
  return toStoreProduct(payload);
}

export async function fetchMyOrders() {
  const session = readAuthSession();
  if (!session?.idToken) {
    throw new Error("Ban can dang nhap de xem lich su mua hang.");
  }

  const response = await fetch(`${getStorefrontBasePath()}/orders/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.idToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || "Khong the tai lich su mua hang.");
  }

  const payload = (await response.json().catch(() => [])) as StorefrontOrderApiItem[];
  return payload.map((item): StoreOrder => ({
    id: item.id,
    customerEmail: item.customerEmail,
    status: item.status,
    items: item.items ?? [],
    totalAmount: Number(item.totalAmount ?? 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
}
