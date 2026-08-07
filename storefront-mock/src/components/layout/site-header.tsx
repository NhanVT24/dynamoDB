import { Menu, Moon, Search, ShoppingCart, Sun } from "lucide-react";
import { useState } from "react";
import type { DragEvent } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { findProductById } from "../../data/catalog";
import { useCart } from "../../stores/cart-store";
import { useTheme } from "../../stores/theme-store";

const navItems = [
  { to: "/", label: "Trang chủ" },
  { to: "/products", label: "Sản phẩm" }
];

export function SiteHeader() {
  const location = useLocation();
  const { count, toggleDrawer, addCatalogItem } = useCart();
  const { theme, toggleTheme } = useTheme();
  const [isCartDropActive, setIsCartDropActive] = useState(false);
  const isDark = theme === "dark";

  function handleCartDragOver(event: DragEvent<HTMLButtonElement>) {
    if (!event.dataTransfer.types.includes("application/x-store-product-id")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsCartDropActive(true);
  }

  function handleCartDragLeave() {
    setIsCartDropActive(false);
  }

  function handleCartDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsCartDropActive(false);
    const productId = event.dataTransfer.getData("application/x-store-product-id");
    if (!productId) return;

    const product = findProductById(productId);
    if (!product || product.status === "out_of_stock") return;
    addCatalogItem(product, 1);
  }

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-xl transition-colors ${
        isDark ? "border-white/10 bg-slate-950/85" : "border-slate-200 bg-white/92"
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 text-sm font-bold tracking-[0.28em] text-white">
              NX
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-orange-500">NovaX Market</p>
              <p className={`truncate text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>Storefront client mock riêng</p>
            </div>
          </Link>

          <nav
            className={`hidden items-center gap-2 rounded-full p-1 lg:flex ${
              isDark ? "bg-white/5" : "bg-slate-100"
            }`}
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-full px-5 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm"
                      : isDark
                        ? "text-slate-300 hover:bg-white/8 hover:text-white"
                        : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto hidden min-w-[18rem] items-center gap-3 rounded-full border px-4 py-3 md:flex lg:min-w-[24rem] xl:min-w-[28rem]">
            <Search size={16} className={isDark ? "text-slate-400" : "text-slate-500"} />
            <span className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {location.pathname === "/products" ? "Tìm laptop, tai nghe, phụ kiện..." : "Tìm deal hot và sản phẩm nổi bật"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
                isDark
                  ? "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              onClick={() => toggleDrawer(true)}
              onDragOver={handleCartDragOver}
              onDragEnter={() => setIsCartDropActive(true)}
              onDragLeave={handleCartDragLeave}
              onDrop={handleCartDrop}
              className={`relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
                isCartDropActive
                  ? "scale-110 border-orange-400 bg-orange-500 text-white shadow-[0_0_0_6px_rgba(249,115,22,0.18)]"
                  : isDark
                    ? "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              <ShoppingCart size={18} />
              {count > 0 ? (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-orange-500 px-1 text-[11px] font-bold text-white">
                  {count}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border lg:hidden ${
                isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 px-4 py-2 text-center text-xs font-medium text-white">
        Freeship đơn từ 3 triệu • Mock storefront riêng trên `localhost:4174` • Sẵn sàng để nối payment sandbox sau
      </div>
    </header>
  );
}
