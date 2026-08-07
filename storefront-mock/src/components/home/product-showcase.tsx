import { Link } from "react-router-dom";
import { useTheme } from "../../stores/theme-store";
import type { StoreProduct } from "../../types/store";
import { ProductCard } from "../common/product-card";
import { SectionHeading } from "../common/section-heading";

type ProductShowcaseProps = {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  products: StoreProduct[];
  onAddToCart: (product: StoreProduct) => void;
};

export function ProductShowcase({ id, eyebrow, title, description, products, onAddToCart }: ProductShowcaseProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <section id={id} className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          action={
            <Link
              to="/products"
              className={`inline-flex rounded-full border px-5 py-3 text-sm font-semibold transition ${
                isDark ? "border-white/10 bg-white/5 text-white hover:bg-white/10" : "border-slate-300 bg-white text-slate-950 hover:border-slate-950"
              }`}
            >
              Xem toàn bộ
            </Link>
          }
        />

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
          ))}
        </div>
      </div>
    </section>
  );
}
