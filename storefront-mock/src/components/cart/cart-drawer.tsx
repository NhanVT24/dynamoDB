import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useCart } from "../../stores/cart-store";
import { useTheme } from "../../stores/theme-store";
import { formatCurrency } from "../../utils/format";

export function CartDrawer() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { items, isDrawerOpen, toggleDrawer, updateQuantity, removeItem, subtotal, shipping, discount, total, clearCart } = useCart();

  return (
    <AnimatePresence>
      {isDrawerOpen ? (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => toggleDrawer(false)}
          />
          <motion.aside
            className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l p-6 shadow-2xl ${
              isDark ? "border-white/10 bg-[#0f172a]" : "border-slate-200 bg-white"
            }`}
            initial={{ x: 460 }}
            animate={{ x: 0 }}
            exit={{ x: 460 }}
            transition={{ type: "spring", stiffness: 240, damping: 30 }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Giỏ hàng</p>
                <h3 className={`mt-2 text-2xl font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>Mua sắm nhanh</h3>
                <p className={`mt-2 max-w-sm text-sm ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                  Khu vực giỏ hàng này mô phỏng kiểu side cart quen thuộc của các sàn thương mại điện tử.
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleDrawer(false)}
                className={`rounded-2xl border p-3 transition ${
                  isDark
                    ? "border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-950"
                }`}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 flex-1 space-y-4 overflow-y-auto pr-2">
              {items.length === 0 ? (
                <div className={`rounded-[1.75rem] border border-dashed p-8 text-center ${isDark ? "border-white/10 bg-white/5" : "border-slate-300 bg-slate-50"}`}>
                  <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${isDark ? "bg-white/10 text-white" : "bg-white text-slate-950 shadow-sm"}`}>
                    <ShoppingCart size={22} />
                  </div>
                  <h4 className={`mt-5 text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>Giỏ hàng đang trống</h4>
                  <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                    Chọn vài sản phẩm trên trang chủ hoặc trang danh sách để kiểm tra luồng thêm vào giỏ hàng.
                  </p>
                  <Link
                    to="/products"
                    onClick={() => toggleDrawer(false)}
                    className="mt-6 inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    Đi xem sản phẩm
                  </Link>
                </div>
              ) : (
                items.map((item) => (
                  <article
                    key={item.variantId}
                    className={`rounded-[1.75rem] border p-4 ${
                      isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex gap-4">
                      <img src={item.image} alt={item.productName} className="h-24 w-24 rounded-3xl object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className={`line-clamp-2 font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{item.productName}</h4>
                            <p className={`mt-1 text-sm ${isDark ? "text-slate-300" : "text-slate-500"}`}>{item.variantName}</p>
                            <p className={`mt-1 text-xs uppercase tracking-[0.18em] ${isDark ? "text-slate-500" : "text-slate-400"}`}>{item.sku}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(item.variantId)}
                            className={`rounded-2xl p-2 transition ${
                              isDark ? "text-slate-400 hover:bg-white/10 hover:text-rose-400" : "text-slate-400 hover:bg-white hover:text-rose-500"
                            }`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className={`inline-flex items-center rounded-full border p-1 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                              className={`rounded-full p-2 transition ${isDark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
                            >
                              <Minus size={14} />
                            </button>
                            <span className={`min-w-10 text-center text-sm font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                              className={`rounded-full p-2 transition ${isDark ? "text-slate-300 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          <strong className={isDark ? "text-white" : "text-slate-950"}>{formatCurrency(item.price * item.quantity)}</strong>
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="mt-6 rounded-[1.75rem] bg-gradient-to-r from-orange-500 to-red-500 p-5 text-white">
              <SummaryRow label="Tạm tính" value={formatCurrency(subtotal)} />
              <SummaryRow label="Vận chuyển" value={shipping === 0 ? "Miễn phí" : formatCurrency(shipping)} />
              <SummaryRow label="Ưu đãi mock" value={`-${formatCurrency(discount)}`} />
              <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-4">
                <span className="text-sm text-orange-50">Tổng dự kiến</span>
                <span className="text-xl font-semibold">{formatCurrency(total)}</span>
              </div>
              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  onClick={clearCart}
                  className="rounded-full border border-white/20 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Xóa toàn bộ
                </button>
                <button type="button" className="rounded-full bg-white px-4 py-3 text-sm font-semibold text-orange-600 transition hover:bg-orange-50">
                  Thanh toán sandbox sau
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex items-center justify-between text-sm text-orange-50">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
