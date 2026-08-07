import { motion } from "framer-motion";
import { ShoppingCart, Star } from "lucide-react";
import { useRef } from "react";
import type { DragEvent } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../../stores/theme-store";
import type { StoreProduct } from "../../types/store";
import { formatCurrency } from "../../utils/format";

type ProductCardProps = {
  product: StoreProduct;
  onAddToCart: (product: StoreProduct) => void;
};

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const { theme } = useTheme();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isDark = theme === "dark";
  const discountPercent = Math.max(0, Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100));
  const isOut = product.status === "out_of_stock";

  function handleDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-store-product-id", product.id);
    event.dataTransfer.setData("text/plain", product.name);
    if (imageRef.current) {
      event.dataTransfer.setDragImage(imageRef.current, 64, 64);
    }
  }

  return (
    <motion.article
      layout
      whileHover={{ y: -4 }}
      draggable={!isOut}
      onDragStartCapture={handleDragStart}
      className={`group relative overflow-hidden rounded-[1.75rem] border transition ${
        isDark
          ? "border-white/10 bg-slate-900/85 shadow-[0_20px_70px_-48px_rgba(0,0,0,0.75)]"
          : "border-slate-200 bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.35)]"
      } ${isOut ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
    >
      <Link to={`/products/${product.slug}`} className="absolute inset-0 z-20" aria-label={product.name} />

      <div className="relative overflow-hidden">
        <img
          ref={imageRef}
          src={product.imageUrl}
          alt={product.name}
          className="h-64 w-full object-cover transition duration-500 group-hover:scale-105"
          draggable={false}
        />
        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pt-4 transition duration-300 group-hover:opacity-0">
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
        <div className="absolute inset-0 bg-slate-950/0 transition duration-300 group-hover:bg-slate-950/58" />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center opacity-0 transition duration-300 group-hover:opacity-100">
          <p className="text-sm font-medium text-white/90">{product.description}</p>
          <div className="mt-5">
            <div className="text-sm text-white/70 line-through">{formatCurrency(product.originalPrice)}</div>
            <strong className="mt-1 block text-3xl font-bold text-white">{formatCurrency(product.price)}</strong>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddToCart(product);
            }}
            disabled={isOut}
            className="pointer-events-auto mt-5 inline-flex min-w-[9rem] items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400"
          >
            <ShoppingCart size={16} className="mr-2 shrink-0" />
            {isOut ? "Hết hàng" : "Thêm vào giỏ"}
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
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-600">
            <Star size={13} className="fill-amber-400 text-amber-400" />
            {product.rating}
          </span>
          <span className={`rounded-full px-2.5 py-1 ${isDark ? "bg-white/8 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
            Đã bán {product.soldCount}
          </span>
        </div>

        <div className="mt-4">
          <div className="text-[13px] text-slate-400 line-through">{formatCurrency(product.originalPrice)}</div>
          <strong className="text-2xl font-bold text-orange-500">{formatCurrency(product.price)}</strong>
        </div>
      </div>
    </motion.article>
  );
}
