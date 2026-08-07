import { Link } from "react-router-dom";
import { useTheme } from "../../stores/theme-store";
import type { StoreCategory } from "../../types/store";
import { SectionHeading } from "../common/section-heading";

export function CategoryStrip({ categories }: { categories: StoreCategory[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <section className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Danh mục"
          title="Danh mục nổi bật cho storefront client"
          description="Mỗi cụm danh mục được trình bày gọn hơn theo kiểu sàn thương mại điện tử, giúp người xem quét nhanh và vào đúng nhóm sản phẩm cần tìm."
        />

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => (
            <Link
              key={category.id}
              to={`/products?category=${encodeURIComponent(category.label)}`}
              className={`group relative overflow-hidden rounded-[1.75rem] border p-5 transition ${
                isDark
                  ? "border-white/10 bg-white/5 hover:bg-white/7"
                  : "border-slate-200 bg-white hover:shadow-[0_24px_72px_-50px_rgba(15,23,42,0.28)]"
              }`}
            >
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${category.accent}`} />
              <div className="flex items-start gap-4">
                <img src={category.imageUrl} alt={category.label} className="h-24 w-24 rounded-3xl object-cover" />
                <div>
                  <h3 className={`text-xl font-semibold transition group-hover:text-orange-500 ${isDark ? "text-white" : "text-slate-950"}`}>{category.label}</h3>
                  <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-500"}`}>{category.description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
