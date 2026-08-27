"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { fetchStorefrontProducts } from "../store-api";
import { storeCategories } from "../store-data";
import type { StoreProduct } from "../store-types";
import { formatCurrency } from "../store-utils";
import { SectionTitle, useStorefront } from "../store-client";

type SortMode = "newest" | "oldest" | "price-asc" | "price-desc" | "best-seller";
type PaginationToken = number | "ellipsis";

function normalizeVietnameseText(value: string | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isAllCategory(value: string | undefined) {
  const normalizedCategory = normalizeVietnameseText(value);
  return !normalizedCategory || normalizedCategory === normalizeVietnameseText("Tất cả") || normalizedCategory === "all";
}

const legacyCategoryIds: Record<string, string> = {
  "dien tu": "dien-tu",
  "gia dung": "gia-dung",
  "thoi trang": "thoi-trang",
  "lam dep": "lam-dep",
  "me va be": "me-va-be",
  "bach hoa": "bach-hoa"
};

function toCategoryId(value: string | undefined) {
  if (isAllCategory(value)) {
    return "all";
  }

  const normalizedValue = normalizeVietnameseText(value);
  const configuredCategory = storeCategories.find((item) =>
    normalizeVietnameseText(item.id) === normalizedValue || normalizeVietnameseText(item.label) === normalizedValue
  );

  return configuredCategory?.id ?? legacyCategoryIds[normalizedValue] ?? normalizedValue;
}

function buildPaginationTokens(currentPage: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([
    1,
    2,
    totalPages - 1,
    totalPages,
    Math.max(1, currentPage - 1),
    currentPage,
    Math.min(totalPages, currentPage + 1)
  ]);

  const sortedPages = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const tokens: PaginationToken[] = [];

  for (const page of sortedPages) {
    const previous = tokens[tokens.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      tokens.push("ellipsis");
    }
    tokens.push(page);
  }

  return tokens;
}

function ProductCard({ product }: { product: StoreProduct }) {
  const { addCatalogItem, theme } = useStorefront();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isDark = theme === "dark";
  const discountPercent = Math.max(0, Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100));
  const isUnavailable = product.status === "out_of_stock" || product.isLocked;

  function handleDragStart(event: DragEvent<HTMLElement>) {
    if (isUnavailable) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-store-product-id", product.id);
    event.dataTransfer.setData("application/x-store-product", JSON.stringify(product));
    event.dataTransfer.setData("text/plain", product.name);
    if (imageRef.current) {
      event.dataTransfer.setDragImage(imageRef.current, 64, 64);
    }
  }

  return (
    <article
      draggable={!isUnavailable}
      onDragStartCapture={handleDragStart}
      className={`group relative overflow-hidden rounded-[1.75rem] border ${
        isDark ? "border-white/10 bg-slate-900/85" : "border-slate-200 bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.35)]"
      } ${isUnavailable ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
    >
      <Link href={`/store/products/${product.slug}`} className="absolute inset-0 z-10" aria-label={product.name} />
      <div className="relative overflow-hidden">
        <img
          ref={imageRef}
          src={product.imageUrl}
          alt={product.name}
          className="h-64 w-full object-cover transition duration-500 group-hover:scale-105"
          draggable={false}
        />
        <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 pt-4 transition duration-300 group-hover:opacity-0">
          <span className="rounded-full bg-orange-500 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
            -{discountPercent}%
          </span>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
              isDark ? "bg-white/10 text-slate-200" : "bg-white/90 text-slate-700"
            }`}
          >
            {product.category}
          </span>
        </div>
        <div className="absolute inset-0 z-20 bg-slate-950/0 transition duration-300 group-hover:bg-slate-950/72" />
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center opacity-0 transition duration-300 group-hover:opacity-100">
          <p className="line-clamp-4 text-sm font-medium leading-6 text-white/90">{product.description}</p>
          <div className="mt-5">
            <div className="text-sm text-white/70 line-through">{formatCurrency(product.originalPrice)}</div>
            <strong className="mt-1 block text-3xl font-bold text-white">{formatCurrency(product.price)}</strong>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              addCatalogItem(product, 1);
            }}
            disabled={isUnavailable}
            className="pointer-events-auto mt-5 inline-flex min-w-[9rem] items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400"
          >
            {product.isLocked ? "Đang được giữ" : product.status === "out_of_stock" ? "Hết hàng" : "Thêm vào giỏ"}
          </button>
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs">
          <span className={isDark ? "text-slate-400" : "text-slate-500"}>{product.brand}</span>
          <span className={isDark ? "text-slate-600" : "text-slate-300"}>•</span>
          <span className={isDark ? "text-slate-400" : "text-slate-500"}>{product.location}</span>
        </div>
        <h3 className={`mt-2 line-clamp-2 min-h-14 text-lg font-semibold leading-7 ${isDark ? "text-white" : "text-slate-950"}`}>
          {product.name}
        </h3>
        <p className={`mt-2 line-clamp-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
          {product.description}
        </p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-600">★ {product.rating}</span>
          <span className={`rounded-full px-2.5 py-1 ${isDark ? "bg-white/8 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
            Đã bán {product.soldCount}
          </span>
        </div>
        <div className="mt-4">
          <div className="text-[13px] text-slate-400 line-through">{formatCurrency(product.originalPrice)}</div>
          <strong className="text-2xl font-bold text-orange-500">{formatCurrency(product.price)}</strong>
        </div>
        {product.isLocked ? (
          <p className="mt-3 text-sm font-medium text-amber-600">Sản phẩm này đang được giữ tạm thời, vui lòng thử lại sau.</p>
        ) : null}
      </div>
    </article>
  );
}

function ProductCardSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <article
      className={`animate-pulse overflow-hidden rounded-[1.75rem] border ${
        isDark ? "border-white/10 bg-slate-900/85" : "border-slate-200 bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.35)]"
      }`}
    >
      <div className={`h-64 w-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
      <div className="p-4">
        <div className="flex items-center gap-2">
          <div className={`h-3 w-16 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
          <div className={`h-3 w-3 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
          <div className={`h-3 w-20 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
        </div>
        <div className={`mt-3 h-6 w-4/5 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
        <div className={`mt-2 h-6 w-2/3 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
        <div className="mt-4 grid gap-2">
          <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
          <div className={`h-4 w-5/6 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className={`h-8 w-16 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
          <div className={`h-8 w-20 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
        </div>
        <div className="mt-4">
          <div className={`h-4 w-24 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
          <div className={`mt-2 h-8 w-32 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
        </div>
      </div>
    </article>
  );
}

export function ProductsPageClient({ category, sort }: { category?: string; sort?: string }) {
  const { theme } = useStorefront();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDark = theme === "dark";
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activeCategory = toCategoryId(category);
  const activeSort: SortMode =
    sort === "oldest" || sort === "price-asc" || sort === "price-desc" || sort === "best-seller"
      ? sort
      : "newest";
  const itemsPerPage = 8;

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      setLoading(true);
      setError("");

      try {
        const data = await fetchStorefrontProducts();
        if (!cancelled) {
          setProducts(data.items);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "An unknown error occurred while fetching products.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, [refreshVersion]);

  useEffect(() => {
    function refreshProductsWhenReturningToStorefront() {
      if (document.visibilityState === "visible") {
        setRefreshVersion((current) => current + 1);
      }
    }

    window.addEventListener("focus", refreshProductsWhenReturningToStorefront);
    document.addEventListener("visibilitychange", refreshProductsWhenReturningToStorefront);
    return () => {
      window.removeEventListener("focus", refreshProductsWhenReturningToStorefront);
      document.removeEventListener("visibilitychange", refreshProductsWhenReturningToStorefront);
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = normalizeVietnameseText(keyword);

    return [...products]
      .filter((product) => activeCategory === "all" || toCategoryId(product.category) === activeCategory)
      .filter((product) =>
        normalizedKeyword.length === 0
          ? true
          : normalizeVietnameseText(`${product.name} ${product.brand} ${product.description}`).includes(normalizedKeyword)
      )
      .sort((left, right) => {
        if (activeSort === "oldest") return String(left.updatedAt).localeCompare(String(right.updatedAt));
        if (activeSort === "price-asc") return left.price - right.price;
        if (activeSort === "price-desc") return right.price - left.price;
        if (activeSort === "best-seller") return right.soldCount - left.soldCount;
        return String(right.updatedAt).localeCompare(String(left.updatedAt));
      });
  }, [activeCategory, activeSort, keyword, products]);

  useEffect(() => {
    setPage(1);
  }, [keyword, activeCategory, activeSort]);

  function updateFilters(next: Partial<{ category: string; sort: SortMode }>) {
    const draft = new URLSearchParams(searchParams.toString());
    const nextCategory = toCategoryId(next.category ?? activeCategory);
    const nextSort = next.sort ?? activeSort;

    if (nextCategory === "all") {
      draft.delete("category");
    } else {
      draft.set("category", nextCategory);
    }

    if (nextSort === "newest") {
      draft.delete("sort");
    } else {
      draft.set("sort", nextSort);
    }

    router.replace(draft.size > 0 ? `${pathname}?${draft.toString()}` : pathname, { scroll: false });
  }

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedProducts = filteredProducts.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);
  const paginationTokens = buildPaginationTokens(safePage, totalPages);

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionTitle
          title="Products Store"
          description="Explore our wide range of products, from the latest gadgets to everyday essentials. Use the filters below to find exactly what you're looking for."
        />
        <div className={`mt-8 rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Search Products</span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="Enter product name, brand, or description..."
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${
                  isDark
                    ? "border-white/10 bg-slate-900 text-white placeholder:text-slate-500 focus:border-orange-500"
                    : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400 focus:border-orange-500"
                }`}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Category</span>
              <select
                value={activeCategory}
                onChange={(event) => updateFilters({ category: event.target.value })}
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${
                  isDark ? "border-white/10 bg-slate-900 text-white focus:border-orange-500" : "border-slate-200 bg-slate-50 text-slate-950 focus:border-orange-500"
                }`}
              >
                <option value="all">All Categories</option>
                {storeCategories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Sort By</span>
              <select
                value={activeSort}
                onChange={(event) => updateFilters({ sort: event.target.value as SortMode })}
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${
                  isDark ? "border-white/10 bg-slate-900 text-white focus:border-orange-500" : "border-slate-200 bg-slate-50 text-slate-950 focus:border-orange-500"
                }`}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="best-seller">Best Sellers</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {loading
            ? Array.from({ length: 8 }).map((_, index) => <ProductCardSkeleton key={`skeleton-${index}`} isDark={isDark} />)
            : paginatedProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
        </div>
        {!loading && error ? <p className="mt-6 text-sm font-medium text-rose-500">{error}</p> : null}
        {!loading && !error && totalPages > 1 ? (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                safePage <= 1
                  ? "cursor-not-allowed bg-slate-200 text-slate-400"
                  : isDark
                    ? "bg-white/5 text-white hover:bg-white/10"
                    : "bg-white text-slate-950 shadow-sm hover:bg-slate-50"
              }`}
            >
              Previous page
            </button>
            {paginationTokens.map((token, index) =>
              token === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className={`px-2 text-sm font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  ...
                </span>
              ) : (
                <button
                  key={token}
                  type="button"
                  onClick={() => setPage(token)}
                  className={`h-11 min-w-11 rounded-full px-4 text-sm font-semibold transition ${
                    token === safePage
                      ? "bg-gradient-to-r from-orange-500 to-red-500 text-white"
                      : isDark
                        ? "bg-white/5 text-slate-200 hover:bg-white/10"
                        : "bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                  }`}
                >
                  {token}
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                safePage >= totalPages
                  ? "cursor-not-allowed bg-slate-200 text-slate-400"
                  : isDark
                    ? "bg-white/5 text-white hover:bg-white/10"
                    : "bg-white text-slate-950 shadow-sm hover:bg-slate-50"
              }`}
            >
              Next page
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
