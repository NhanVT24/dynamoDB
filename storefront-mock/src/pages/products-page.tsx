import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHero } from "../components/common/page-hero";
import { ProductCard } from "../components/common/product-card";
import { storeCategories, storeProducts } from "../data/catalog";
import { useCart } from "../stores/cart-store";
import { useTheme } from "../stores/theme-store";
import type { StoreProduct } from "../types/store";

type SortMode = "newest" | "oldest" | "price-asc" | "price-desc" | "best-seller";

const ITEMS_PER_PAGE = 8;

export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { addCatalogItem } = useCart();
  const { theme } = useTheme();
  const [keyword, setKeyword] = useState("");
  const isDark = theme === "dark";

  const activeCategory = searchParams.get("category") ?? "Tất cả";
  const sort = (searchParams.get("sort") as SortMode | null) ?? "newest";
  const currentPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return [...storeProducts]
      .filter((product) => activeCategory === "Tất cả" || product.category === activeCategory)
      .filter((product) =>
        normalizedKeyword.length === 0
          ? true
          : `${product.name} ${product.brand} ${product.description}`.toLowerCase().includes(normalizedKeyword)
      )
      .sort((left, right) => {
        if (sort === "oldest") return String(left.updatedAt).localeCompare(String(right.updatedAt));
        if (sort === "price-asc") return left.price - right.price;
        if (sort === "price-desc") return right.price - left.price;
        if (sort === "best-seller") return right.soldCount - left.soldCount;
        return String(right.updatedAt).localeCompare(String(left.updatedAt));
      });
  }, [activeCategory, keyword, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedProducts = filteredProducts.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  function handleAddToCart(product: StoreProduct) {
    if (product.status === "out_of_stock") return;
    addCatalogItem(product, 1);
  }

  function updateFilters(next: Partial<{ category: string; sort: SortMode; page: number }>) {
    const draft = new URLSearchParams(searchParams);

    if (next.category) {
      if (next.category === "Tất cả") {
        draft.delete("category");
      } else {
        draft.set("category", next.category);
      }
    }

    if (next.sort) {
      if (next.sort === "newest") {
        draft.delete("sort");
      } else {
        draft.set("sort", next.sort);
      }
    }

    if (next.page && next.page > 1) {
      draft.set("page", String(next.page));
    } else {
      draft.delete("page");
    }

    setSearchParams(draft);
  }

  function resetPagingFilter(next: Partial<{ category: string; sort: SortMode }>) {
    updateFilters({ ...next, page: 1 });
  }

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <PageHero
          eyebrow="Catalog"
          title="Danh sách sản phẩm theo hướng sàn thương mại điện tử"
          description="Trang sản phẩm đã có phần đầu trang riêng, mặc định sắp xếp theo newest và phân trang 8 sản phẩm để bố cục gọn hơn."
          crumbs={[
            { label: "Trang chủ", to: "/" },
            { label: "Sản phẩm" }
          ]}
        />

        <div className={`rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Tìm sản phẩm</span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="Nhập tên, thương hiệu hoặc mô tả..."
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${
                  isDark
                    ? "border-white/10 bg-slate-900 text-white placeholder:text-slate-500 focus:border-orange-500"
                    : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400 focus:border-orange-500"
                }`}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Danh mục</span>
              <select
                value={activeCategory}
                onChange={(event) => resetPagingFilter({ category: event.target.value })}
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${
                  isDark
                    ? "border-white/10 bg-slate-900 text-white focus:border-orange-500"
                    : "border-slate-200 bg-slate-50 text-slate-950 focus:border-orange-500"
                }`}
              >
                <option>Tất cả</option>
                {storeCategories.map((category) => (
                  <option key={category.id} value={category.label}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Sắp xếp</span>
              <select
                value={sort}
                onChange={(event) => resetPagingFilter({ sort: event.target.value as SortMode })}
                className={`h-12 rounded-2xl border px-4 text-sm outline-none transition ${
                  isDark
                    ? "border-white/10 bg-slate-900 text-white focus:border-orange-500"
                    : "border-slate-200 bg-slate-50 text-slate-950 focus:border-orange-500"
                }`}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="price-asc">Giá tăng dần</option>
                <option value="price-desc">Giá giảm dần</option>
                <option value="best-seller">Bán chạy</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>
            Hiển thị <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{paginatedProducts.length}</span> /{" "}
            <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{filteredProducts.length}</span> sản phẩm
          </p>
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>
            Trang <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{safePage}</span> /{" "}
            <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{totalPages}</span>
          </p>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {paginatedProducts.map((product) => (
            <ProductCard key={product.id} product={product} onAddToCart={handleAddToCart} />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => updateFilters({ page: safePage - 1 })}
            disabled={safePage <= 1}
            className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
              safePage <= 1
                ? "cursor-not-allowed bg-slate-200 text-slate-400"
                : isDark
                  ? "bg-white/5 text-white hover:bg-white/10"
                  : "bg-white text-slate-950 shadow-sm hover:bg-slate-50"
            }`}
          >
            Trang trước
          </button>

          {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => updateFilters({ page })}
              className={`h-11 min-w-11 rounded-full px-4 text-sm font-semibold transition ${
                page === safePage
                  ? "bg-gradient-to-r from-orange-500 to-red-500 text-white"
                  : isDark
                    ? "bg-white/5 text-slate-200 hover:bg-white/10"
                    : "bg-white text-slate-700 shadow-sm hover:bg-slate-50"
              }`}
            >
              {page}
            </button>
          ))}

          <button
            type="button"
            onClick={() => updateFilters({ page: safePage + 1 })}
            disabled={safePage >= totalPages}
            className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
              safePage >= totalPages
                ? "cursor-not-allowed bg-slate-200 text-slate-400"
                : isDark
                  ? "bg-white/5 text-white hover:bg-white/10"
                  : "bg-white text-slate-950 shadow-sm hover:bg-slate-50"
            }`}
          >
            Trang sau
          </button>
        </div>
      </div>
    </section>
  );
}
