import { Minus, Plus, ShieldCheck, ShoppingCart, Star, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHero } from "../components/common/page-hero";
import { ProductCard } from "../components/common/product-card";
import { findProductBySlug, getRelatedProducts } from "../data/catalog";
import { useCart } from "../stores/cart-store";
import { useTheme } from "../stores/theme-store";
import { formatCurrency, formatShortDate } from "../utils/format";

export function ProductDetailPage() {
  const { slug = "" } = useParams();
  const { addCatalogItem } = useCart();
  const { theme } = useTheme();
  const [quantity, setQuantity] = useState(1);
  const product = findProductBySlug(slug);
  const relatedProducts = useMemo(() => (product ? getRelatedProducts(product) : []), [product]);
  const isDark = theme === "dark";

  if (!product) {
    return (
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-3xl rounded-[2.5rem] border p-10 text-center ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <p className="text-sm uppercase tracking-[0.3em] text-orange-500">Không tìm thấy</p>
          <h1 className={`mt-4 text-3xl font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>Sản phẩm không còn trong mock catalog</h1>
          <Link to="/products" className="mt-6 inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
            Quay lại danh sách
          </Link>
        </div>
      </section>
    );
  }

  const canAdd = product.status !== "out_of_stock";

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <PageHero
          eyebrow="Chi tiết sản phẩm"
          title={product.name}
          description="Trang chi tiết giờ cũng có phần đầu trang riêng để dẫn hướng rõ hơn và đồng bộ với listing."
          crumbs={[
            { label: "Trang chủ", to: "/" },
            { label: "Sản phẩm", to: "/products" },
            { label: product.name }
          ]}
        />

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className={`overflow-hidden rounded-[2rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"}`}>
            <img src={product.imageUrl} alt={product.name} className="h-[28rem] w-full rounded-[1.75rem] object-cover sm:h-[36rem]" />
          </div>

          <div className={`rounded-[2rem] border p-6 sm:p-8 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">{product.category}</p>
            <h1 className={`mt-3 text-4xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{product.name}</h1>
            <p className={`mt-4 text-base leading-8 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{product.description}</p>

            <div className="mt-6 flex flex-wrap gap-3">
              {product.specs.map((spec) => (
                <span key={spec} className={`rounded-full px-4 py-2 text-sm font-medium ${isDark ? "bg-white/8 text-slate-200" : "bg-slate-100 text-slate-600"}`}>
                  {spec}
                </span>
              ))}
            </div>

            <div className="mt-8 flex items-end gap-4">
              <strong className="text-4xl font-bold text-orange-500">{formatCurrency(product.price)}</strong>
              <span className="pb-1 text-lg text-slate-400 line-through">{formatCurrency(product.originalPrice)}</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <InfoTile isDark={isDark} label="Đánh giá" value={`${product.rating} / 5`} icon={<Star size={16} className="fill-amber-400 text-amber-400" />} />
              <InfoTile isDark={isDark} label="Đã bán" value={`${product.soldCount}+`} icon={<ShoppingCart size={16} />} />
              <InfoTile isDark={isDark} label="Cập nhật" value={formatShortDate(product.updatedAt)} icon={<Truck size={16} />} />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <div className={`inline-flex items-center rounded-full border p-1 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  className={`rounded-full p-3 transition ${isDark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-white hover:text-slate-950"}`}
                >
                  <Minus size={16} />
                </button>
                <span className={`min-w-12 text-center font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.min(product.stock || 1, current + 1))}
                  className={`rounded-full p-3 transition ${isDark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-white hover:text-slate-950"}`}
                >
                  <Plus size={16} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => addCatalogItem(product, quantity)}
                disabled={!canAdd}
                className="inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400"
              >
                {canAdd ? "Thêm vào giỏ hàng" : "Hết hàng"}
              </button>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className={`rounded-[1.5rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <div className={`flex items-center gap-3 ${isDark ? "text-white" : "text-slate-950"}`}>
                  <ShieldCheck size={18} />
                  <p className="font-semibold">Bảo hành chính hãng</p>
                </div>
                <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-500"}`}>Flow demo giả lập trải nghiệm mua sản phẩm premium với chính sách rõ ràng.</p>
              </div>
              <div className={`rounded-[1.5rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <div className={`flex items-center gap-3 ${isDark ? "text-white" : "text-slate-950"}`}>
                  <Truck size={18} />
                  <p className="font-semibold">Kho giao từ {product.location}</p>
                </div>
                <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-500"}`}>Sẵn sàng để nối tiếp logic giao hàng hoặc payment sandbox ở giai đoạn sau.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Liên quan</p>
              <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>Cùng danh mục với sản phẩm này</h2>
            </div>
            <Link
              to="/products"
              className={`rounded-full border px-5 py-3 text-sm font-semibold ${
                isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-300 bg-white text-slate-950"
              }`}
            >
              Xem catalog
            </Link>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {relatedProducts.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                onAddToCart={(selected) => {
                  if (selected.status === "out_of_stock") return;
                  addCatalogItem(selected, 1);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoTile({ isDark, label, value, icon }: { isDark: boolean; label: string; value: string; icon: ReactNode }) {
  return (
    <div className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
      <div className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-300" : "text-slate-500"}`}>
        {icon}
        {label}
      </div>
      <p className={`mt-3 text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}
