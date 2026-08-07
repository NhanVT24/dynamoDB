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

function ProductCard({ product }: { product: StoreProduct }) {
  const { addCatalogItem, theme } = useStorefront();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isDark = theme === "dark";
  const discountPercent = Math.max(0, Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100));
  const isOut = product.status === "out_of_stock";

  function handleDragStart(event: DragEvent<HTMLElement>) {
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
      draggable={!isOut}
      onDragStartCapture={handleDragStart}
      className={`group relative overflow-hidden rounded-[1.75rem] border ${isDark ? "border-white/10 bg-slate-900/85" : "border-slate-200 bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.35)]"} ${isOut ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
    >
      <Link href={`/store/products/${product.slug}`} className="absolute inset-0 z-10" aria-label={product.name} />
      <div className="relative overflow-hidden">
        <img ref={imageRef} src={product.imageUrl} alt={product.name} className="h-64 w-full object-cover transition duration-500 group-hover:scale-105" draggable={false} />
        <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 pt-4 transition duration-300 group-hover:opacity-0">
          <span className="rounded-full bg-orange-500 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">-{discountPercent}%</span>
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "bg-white/10 text-slate-200" : "bg-white/90 text-slate-700"}`}>{product.category}</span>
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
            disabled={isOut}
            className="pointer-events-auto mt-5 inline-flex min-w-[9rem] items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400"
          >
            {isOut ? "Het hang" : "Them vao gio"}
          </button>
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs">
          <span className={isDark ? "text-slate-400" : "text-slate-500"}>{product.brand}</span>
          <span className={isDark ? "text-slate-600" : "text-slate-300"}>•</span>
          <span className={isDark ? "text-slate-400" : "text-slate-500"}>{product.location}</span>
        </div>
        <h3 className={`mt-2 line-clamp-2 min-h-14 text-lg font-semibold leading-7 ${isDark ? "text-white" : "text-slate-950"}`}>{product.name}</h3>
        <p className={`mt-2 line-clamp-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{product.description}</p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-600">★ {product.rating}</span>
          <span className={`rounded-full px-2.5 py-1 ${isDark ? "bg-white/8 text-slate-300" : "bg-slate-100 text-slate-600"}`}>Da ban {product.soldCount}</span>
        </div>
        <div className="mt-4">
          <div className="text-[13px] text-slate-400 line-through">{formatCurrency(product.originalPrice)}</div>
          <strong className="text-2xl font-bold text-orange-500">{formatCurrency(product.price)}</strong>
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
  const activeCategory = category ?? "Tat ca";
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
          setProducts(data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Khong the tai du lieu san pham.");
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
  }, []);

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = normalizeVietnameseText(keyword);
    const normalizedActiveCategory = normalizeVietnameseText(activeCategory);
    const normalizedAllCategory = normalizeVietnameseText("Tat ca");

    return [...products]
      .filter((product) => normalizedActiveCategory === normalizedAllCategory || normalizeVietnameseText(product.category) === normalizedActiveCategory)
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
    const nextCategory = next.category ?? activeCategory;
    const nextSort = next.sort ?? activeSort;

    if (normalizeVietnameseText(nextCategory) === normalizeVietnameseText("Tat ca")) {
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

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionTitle
          title="Danh sach san pham"
          description="Bo loc da duoc doi sang so khop khong phan biet dau, nen du lieu co dau hay khong dau deu loc duoc."
        />
        <div className={`mt-8 rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Tim san pham</span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="Nhap ten, thuong hieu hoac mo ta..."
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${isDark ? "border-white/10 bg-slate-900 text-white placeholder:text-slate-500 focus:border-orange-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400 focus:border-orange-500"}`}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Danh muc</span>
              <select
                value={activeCategory}
                onChange={(event) => updateFilters({ category: event.target.value })}
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${isDark ? "border-white/10 bg-slate-900 text-white focus:border-orange-500" : "border-slate-200 bg-slate-50 text-slate-950 focus:border-orange-500"}`}
              >
                <option value="Tat ca">Tat ca</option>
                {storeCategories.map((item) => (
                  <option key={item.id} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Sap xep</span>
              <select
                value={activeSort}
                onChange={(event) => updateFilters({ sort: event.target.value as SortMode })}
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${isDark ? "border-white/10 bg-slate-900 text-white focus:border-orange-500" : "border-slate-200 bg-slate-50 text-slate-950 focus:border-orange-500"}`}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="price-asc">Gia tang dan</option>
                <option value="price-desc">Gia giam dan</option>
                <option value="best-seller">Ban chay</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>Hien thi <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{paginatedProducts.length}</span> / <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{filteredProducts.length}</span> san pham</p>
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>Trang <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{safePage}</span> / <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{totalPages}</span></p>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {paginatedProducts.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
        {loading ? <p className={`mt-6 text-sm ${isDark ? "text-slate-300" : "text-slate-500"}`}>Dang tai san pham...</p> : null}
        {!loading && error ? <p className="mt-6 text-sm font-medium text-rose-500">{error}</p> : null}
      </div>
    </section>
  );
}
