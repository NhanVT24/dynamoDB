"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { storeCategories, storeProducts } from "./store-data";
import { fetchStorefrontProductById, fetchStorefrontProducts } from "./store-api";
import { readAuthSession, signOutFromCognitoHostedUi, type AuthSession } from "../lib/cognito-auth";
import type { CartItem, StoreProduct } from "./store-types";
import { calculateShipping, calculateSubtotal, formatCurrency, formatShortDate } from "./store-utils";

type ThemeMode = "light" | "dark";
type SortMode = "newest" | "oldest" | "price-asc" | "price-desc" | "best-seller";

type StoreContextValue = {
  theme: ThemeMode;
  toggleTheme: () => void;
  items: CartItem[];
  addCatalogItem: (product: StoreProduct, quantity: number) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clearCart: () => void;
  count: number;
  subtotal: number;
  shipping: number;
  total: number;
  isDrawerOpen: boolean;
  toggleDrawer: (open?: boolean) => void;
};

type StoreNotification = {
  id: string;
  title: string;
  message: string;
  status: "pending" | "sent" | "read";
  isRead?: boolean;
  channel: "email" | "system";
  createdAt: string;
  source?: "server" | "local";
};

const StoreContext = createContext<StoreContextValue | null>(null);
const themeStorageKey = "web-storefront-theme";
const cartStorageKey = "web-storefront-cart";
const localNotificationsStorageKey = "web-storefront-local-notifications";
const notificationsUpdatedEvent = "storefront-notifications-updated";

function readLocalNotifications(): StoreNotification[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(localNotificationsStorageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as StoreNotification[];
    return parsed.map((item) => ({
      ...item,
      isRead: Boolean(item.isRead ?? item.status === "read"),
      source: "local"
    }));
  } catch {
    window.localStorage.removeItem(localNotificationsStorageKey);
    return [];
  }
}

function writeLocalNotifications(items: StoreNotification[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(localNotificationsStorageKey, JSON.stringify(items));
  window.dispatchEvent(new Event(notificationsUpdatedEvent));
}

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [items, setItems] = useState<CartItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [hasHydratedCart, setHasHydratedCart] = useState(false);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    } else {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }

    const rawCart = window.localStorage.getItem(cartStorageKey);
    if (rawCart) {
      try {
        const parsed = JSON.parse(rawCart) as CartItem[];
        setItems(parsed);
      } catch {
        window.localStorage.removeItem(cartStorageKey);
      } finally {
        setHasHydratedCart(true);
      }
    } else {
      setHasHydratedCart(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.storeTheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!hasHydratedCart) {
      return;
    }
    window.localStorage.setItem(cartStorageKey, JSON.stringify(items));
  }, [hasHydratedCart, items]);

  function addCatalogItem(product: StoreProduct, quantity: number) {
    setItems((current) => {
      const existing = current.find((item) => item.variantId === product.id);
      if (existing) {
        return current.map((item) =>
          item.variantId === product.id
            ? { ...item, quantity: Math.min(item.quantity + quantity, item.stock) }
            : item
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          variantId: product.id,
          variantName: product.brand,
          sku: product.sku,
          price: product.price,
          quantity,
          stock: product.stock,
          image: product.imageUrl
        }
      ];
    });
    setIsDrawerOpen(true);
  }

  function updateQuantity(variantId: string, quantity: number) {
    setItems((current) =>
      current.map((item) =>
        item.variantId === variantId
          ? { ...item, quantity: Math.max(1, Math.min(quantity, item.stock)) }
          : item
      )
    );
  }

  function removeItem(variantId: string) {
    setItems((current) => current.filter((item) => item.variantId !== variantId));
  }

  function clearCart() {
    setItems([]);
  }

  function toggleDrawer(open?: boolean) {
    setIsDrawerOpen((current) => (typeof open === "boolean" ? open : !current));
  }

  const subtotal = useMemo(() => calculateSubtotal(items), [items]);
  const shipping = useMemo(() => calculateShipping(items), [items]);
  const total = subtotal + shipping;
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <StoreContext.Provider
      value={{
        theme,
        toggleTheme: () => setTheme((current) => (current === "light" ? "dark" : "light")),
        items,
        addCatalogItem,
        updateQuantity,
        removeItem,
        clearCart,
        count,
        subtotal,
        shipping,
        total,
        isDrawerOpen,
        toggleDrawer
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStorefront() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStorefront must be used inside StorefrontProvider");
  return context;
}

function CartDrawer() {
  const { items, isDrawerOpen, toggleDrawer, updateQuantity, removeItem, subtotal, shipping, total, clearCart, theme } = useStorefront();
  const isDark = theme === "dark";

  if (!isDrawerOpen) return null;

  return (
    <>
      <button className="fixed inset-0 z-40 bg-slate-950/55" onClick={() => toggleDrawer(false)} />
      <aside className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l p-6 ${isDark ? "border-white/10 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950"}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-500">Giỏ hàng</p>
            <h3 className="mt-2 text-2xl font-semibold">Mua sắm nhanh</h3>
          </div>
          <button className="rounded-2xl border px-3 py-2" onClick={() => toggleDrawer(false)}>Đóng</button>
        </div>
        <div className="mt-6 flex-1 space-y-4 overflow-y-auto pr-2">
          {items.length === 0 ? (
            <div className={`rounded-[1.5rem] border border-dashed p-6 text-sm ${isDark ? "border-white/10 bg-white/5 text-slate-300" : "border-slate-300 bg-slate-50 text-slate-600"}`}>
              Giỏ hàng đang trống.
            </div>
          ) : items.map((item) => (
            <article key={item.variantId} className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex gap-4">
                <img src={item.image} alt={item.productName} className="h-20 w-20 rounded-3xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="line-clamp-2 font-semibold">{item.productName}</h4>
                      <p className={`mt-1 text-sm ${isDark ? "text-slate-300" : "text-slate-500"}`}>{item.variantName}</p>
                    </div>
                    <button onClick={() => removeItem(item.variantId)} className="text-sm text-rose-500">Xóa</button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 rounded-full border px-2 py-1">
                      <button onClick={() => updateQuantity(item.variantId, item.quantity - 1)}>-</button>
                      <span>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.variantId, item.quantity + 1)}>+</button>
                    </div>
                    <strong>{formatCurrency(item.price * item.quantity)}</strong>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-6 rounded-[1.75rem] bg-gradient-to-r from-orange-500 to-red-500 p-5 text-white">
          <div className="flex justify-between text-sm"><span>Tạm tính</span><span>{formatCurrency(subtotal)}</span></div>
          <div className="mt-2 flex justify-between text-sm"><span>Vận chuyển</span><span>{shipping === 0 ? "Miễn phí" : formatCurrency(shipping)}</span></div>
          <div className="mt-4 flex justify-between border-t border-white/20 pt-4 text-lg font-semibold"><span>Tổng</span><span>{formatCurrency(total)}</span></div>
          <div className="mt-4 grid gap-3">
            <button onClick={clearCart} className="rounded-full border border-white/20 px-4 py-3 font-semibold">Xóa toàn bộ</button>
            <Link
              href="/store/checkout"
              onClick={() => toggleDrawer(false)}
              className="rounded-full bg-white px-4 py-3 text-center font-semibold text-orange-600"
            >
              Thanh toán sandbox
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}

function NotificationBell({ session, isDark }: { session: AuthSession | null; isDark: boolean }) {
  const [notifications, setNotifications] = useState<StoreNotification[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      const localItems = readLocalNotifications();

      if (!session?.idToken) {
        if (!cancelled) {
          setNotifications(localItems);
          setPendingCount(localItems.filter((item) => !item.isRead).length);
        }
        return;
      }

      try {
        const response = await fetch("/api/lambda-proxy/api/notifications/me", {
          headers: {
            Authorization: `Bearer ${session.idToken}`
          },
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = await response.json() as { items?: StoreNotification[]; pendingCount?: number };
        if (cancelled) {
          return;
        }

        const serverItems = (payload.items ?? []).map((item) => ({ ...item, source: "server" as const }));
        const mergedItems = [...localItems, ...serverItems]
          .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

        setNotifications(mergedItems);
        setPendingCount(Number(payload.pendingCount ?? 0) + localItems.filter((item) => !item.isRead).length);
      } catch {}
    }

    void loadNotifications();
    const handleNotificationsUpdated = () => {
      void loadNotifications();
    };

    window.addEventListener(notificationsUpdatedEvent, handleNotificationsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(notificationsUpdatedEvent, handleNotificationsUpdated);
    };
  }, [session?.idToken]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current) {
        return;
      }

      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function handleDismissNotification(item: StoreNotification) {
    if (!session?.idToken) {
      if (item.source === "local") {
        const nextItems = readLocalNotifications().map((entry) =>
          entry.id === item.id
            ? { ...entry, isRead: true, status: "read" as const }
            : entry
        );
        writeLocalNotifications(nextItems);
      }
      return;
    }

    if (item.source === "local") {
      const nextItems = readLocalNotifications().map((entry) =>
        entry.id === item.id
          ? { ...entry, isRead: true, status: "read" as const }
          : entry
      );
      writeLocalNotifications(nextItems);
      return;
    }
    try {
      const response = await fetch(`/api/lambda-proxy/api/notifications/${item.id}/read`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.idToken}`
        }
      });

      if (!response.ok) {
        throw new Error("Failed to dismiss notification.");
      }

      setNotifications((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, isRead: true, status: "read" as const }
            : entry
        )
      );
      setPendingCount((current) => Math.max(0, current - (!item.isRead ? 1 : 0)));
    } catch {}
  }

  async function handleDeleteNotification(item: StoreNotification) {
    if (!session?.idToken || item.source === "local") {
      const nextItems = readLocalNotifications().filter((entry) => entry.id !== item.id);
      writeLocalNotifications(nextItems);
      setNotifications((current) => current.filter((entry) => entry.id !== item.id));
      setPendingCount((current) => Math.max(0, current - (!item.isRead ? 1 : 0)));
      return;
    }

    try {
      const response = await fetch(`/api/lambda-proxy/api/notifications/${item.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.idToken}`
        }
      });

      if (!response.ok) {
        throw new Error("Failed to delete notification.");
      }

      setNotifications((current) => current.filter((entry) => entry.id !== item.id));
      setPendingCount((current) => Math.max(0, current - (!item.isRead ? 1 : 0)));
    } catch {}
  }

  async function handleMarkAllAsRead() {
    const unreadItems = notifications.filter((item) => !item.isRead);
    if (unreadItems.length === 0) {
      return;
    }

    const localUnread = unreadItems.filter((item) => item.source === "local" || !session?.idToken);
    if (localUnread.length > 0) {
      const unreadIds = new Set(localUnread.map((item) => item.id));
      const nextItems = readLocalNotifications().map((entry) =>
        unreadIds.has(entry.id)
          ? { ...entry, isRead: true, status: "read" as const }
          : entry
      );
      writeLocalNotifications(nextItems);
    }

    const serverUnread = unreadItems.filter((item) => item.source !== "local");
    if (session?.idToken && serverUnread.length > 0) {
      try {
        await Promise.all(serverUnread.map(async (item) => {
          const response = await fetch(`/api/lambda-proxy/api/notifications/${item.id}/read`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${session.idToken}`
            }
          });

          if (!response.ok) {
            throw new Error("Failed to mark all notifications as read.");
          }
        }));
      } catch {
        return;
      }
    }

    setNotifications((current) =>
      current.map((item) => ({ ...item, isRead: true, status: "read" as const }))
    );
    setPendingCount(0);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Mở thông báo"
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition-colors ${isDark ? "border-white/20 bg-white text-slate-900 hover:bg-slate-100" : "border-slate-900 bg-white text-slate-900 hover:bg-slate-100"}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 18H5.5a1 1 0 0 1-.8-1.6l1.3-1.7V10a6 6 0 1 1 12 0v4.7l1.3 1.7a1 1 0 0 1-.8 1.6H15" />
          <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
        </svg>
        {pendingCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
            {pendingCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={`absolute right-0 mt-3 w-[21rem] rounded-[1.5rem] border p-4 shadow-2xl ${isDark ? "border-white/10 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950"}`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Thông báo</p>
            <span className="text-xs text-orange-500">{pendingCount} chưa đọc</span>
          </div>
          {notifications.length > 0 ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void handleMarkAllAsRead()}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isDark ? "bg-white/10 text-slate-200 hover:bg-white/15 hover:text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"}`}
              >
                Đánh dấu tất cả đã đọc
              </button>
            </div>
          ) : null}
          <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {notifications.length === 0 ? (
              <div className={`rounded-2xl border border-dashed p-4 text-sm ${isDark ? "border-white/10 text-slate-300" : "border-slate-200 text-slate-500"}`}>
                Chưa có thông báo nào.
              </div>
            ) : notifications.slice(0, 5).map((item) => (
              <div key={item.id} className={`rounded-2xl border p-3 ${isDark ? "border-white/10 bg-white/5" : "border-slate-100 bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className={`line-clamp-2 text-sm font-semibold ${item.isRead ? (isDark ? "text-slate-300" : "text-slate-500") : ""}`}>{item.title}</p>
                </div>
                <p className={`mt-2 line-clamp-3 text-xs leading-5 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{item.message}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!item.isRead ? (
                    <button
                      type="button"
                      onClick={() => void handleDismissNotification(item)}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isDark ? "bg-white/10 text-slate-200 hover:bg-white/15 hover:text-white" : "bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                    >
                      Đánh dấu đã đọc
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDeleteNotification(item)}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isDark ? "bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 hover:text-white" : "bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700"}`}
                  >
                    Xóa
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
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
    if (imageRef.current) event.dataTransfer.setDragImage(imageRef.current, 64, 64);
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
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-600">★ {product.rating}</span>
          <span className={`rounded-full px-2.5 py-1 ${isDark ? "bg-white/8 text-slate-300" : "bg-slate-100 text-slate-600"}`}>Đã bán {product.soldCount}</span>
        </div>
        <div className="mt-4">
          <div className="text-[13px] text-slate-400 line-through">{formatCurrency(product.originalPrice)}</div>
          <strong className="text-2xl font-bold text-orange-500">{formatCurrency(product.price)}</strong>
        </div>
      </div>
    </article>
  );
}

export function StorefrontShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme, count, toggleDrawer, addCatalogItem, theme: currentTheme } = useStorefront();
  const pathname = usePathname();
  const isDark = theme === "dark";
  const [isCartDropActive, setIsCartDropActive] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    setSession(readAuthSession());
  }, []);

  function handleCartDragOver(event: DragEvent<HTMLButtonElement>) {
    if (!event.dataTransfer.types.includes("application/x-store-product-id")) return;
    event.preventDefault();
    setIsCartDropActive(true);
  }

  function handleCartDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsCartDropActive(false);
    const rawProduct = event.dataTransfer.getData("application/x-store-product");
    if (!rawProduct) return;

    try {
      const product = JSON.parse(rawProduct) as StoreProduct;
      if (product.status !== "out_of_stock") addCatalogItem(product, 1);
    } catch {}
  }

  function handleStorefrontLogout() {
    try {
      signOutFromCognitoHostedUi();
    } catch {
      setSession(null);
    }
  }

  return (
    <div className={`${isDark ? "bg-[#0b1220] text-slate-100" : "bg-[linear-gradient(180deg,_#f6f8fc_0%,_#eef3ff_26%,_#ffffff_100%)] text-slate-950"} min-h-screen transition-colors duration-300`}>
      <header className={`sticky top-0 z-40 border-b backdrop-blur-xl ${isDark ? "border-white/10 bg-slate-950/85" : "border-slate-200 bg-white/92"}`}>
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link href="/store" className="flex min-w-0 items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 text-sm font-bold tracking-[0.28em] text-white">NX</div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-orange-500">NovaX Market</p>
                <p className={`truncate text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>Storefront client tích hợp trong web app</p>
              </div>
            </Link>
            <nav className={`hidden items-center gap-2 rounded-full p-1 lg:flex ${isDark ? "bg-white/5" : "bg-slate-100"}`}>
              <Link href="/store" className={`rounded-full px-5 py-2.5 text-sm font-medium ${pathname === "/store" ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "text-slate-300 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>{"Trang ch\u1ee7"}</Link>
              <Link href="/store/products" className={`rounded-full px-5 py-2.5 text-sm font-medium ${pathname.startsWith("/store/products") ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "text-slate-300 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>{"S\u1ea3n ph\u1ea9m"}</Link>
              <Link href="/store/orders" className={`rounded-full px-5 py-2.5 text-sm font-medium ${pathname.startsWith("/store/orders") ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "text-slate-300 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>Lịch sử mua</Link>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <NotificationBell session={session} isDark={isDark} />
              {session ? (
                <div className="hidden items-center gap-2 lg:flex">
                  <div className={`rounded-2xl px-4 py-2 text-right ${isDark ? "bg-white/5 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
                    <p className="max-w-40 truncate text-sm font-semibold">{session.name}</p>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${session.role === "admin" ? "text-cyan-500" : "text-orange-500"}`}>
                      {session.role === "admin" ? "Admin" : "Customer"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleStorefrontLogout}
                    className={`inline-flex h-11 items-center justify-center rounded-2xl border px-4 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                  >
                    {"\u0110\u0103ng xu\u1ea5t"}
                  </button>
                </div>
              ) : (
                <Link
                  href="/"
                  className={`hidden h-11 items-center justify-center rounded-2xl border px-4 text-sm font-semibold lg:inline-flex ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  {"\u0110\u0103ng nh\u1eadp"}
                </Link>
              )}
              <button onClick={toggleTheme} className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border ${isDark ? "border-white/10 bg-white/5 text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}>{currentTheme === "dark" ? "☀" : "☾"}</button>
              <button
                onClick={() => toggleDrawer(true)}
                onDragOver={handleCartDragOver}
                onDragLeave={() => setIsCartDropActive(false)}
                onDrop={handleCartDrop}
                className={`relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition ${isCartDropActive ? "scale-110 border-orange-400 bg-orange-500 text-white shadow-[0_0_0_6px_rgba(249,115,22,0.18)]" : isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-700"}`}
              >
                🛒
                {count > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-orange-500 px-1 text-[11px] font-bold text-white">{count}</span> : null}
              </button>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 px-4 py-2 text-center text-xs font-medium text-white">Storefront client đã được nối vào dự án tại route /store</div>
      </header>
      <CartDrawer />
      <main>{children}</main>
    </div>
  );
}

export function HomeSections() {
  const { theme } = useStorefront();
  const isDark = theme === "dark";
  const [products, setProducts] = useState<StoreProduct[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      try {
        const data = await fetchStorefrontProducts();
        if (!cancelled) setProducts(data.items);
      } catch {}
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  const bestSellerProducts = [...products].sort((a, b) => b.soldCount - a.soldCount).slice(0, 8);
  const flashSaleProducts = [...products].sort((a, b) => (b.originalPrice - b.price) - (a.originalPrice - a.price)).slice(0, 4);
  const newArrivals = [...products].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8);

  return (
    <>
      <section className="px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
            <div className={`rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 lg:px-10 ${isDark ? "bg-[#101826]" : "bg-white"}`}>
              <div className="inline-flex rounded-full bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-orange-600">Deal công nghệ hôm nay</div>
              <h1 className={`mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl ${isDark ? "text-white" : "text-slate-950"}`}>Storefront client đã nối vào dự án hiện tại để test mua hàng trực tiếp.</h1>
              <p className={`mt-5 max-w-2xl text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>Luồng này chạy ngay trong Next app ở route /store, giữ nguyên admin ở route gốc và có sẵn dark mode, kéo thả vào giỏ và listing riêng.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/store/products" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">Mua ngay</Link>
                <Link href="/store/products" className={`rounded-full border px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10 text-white" : "border-slate-200 text-slate-800"}`}>Xem catalog</Link>
              </div>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {["24+ Sản phẩm mock", "6 Danh mục chính", "8 Sản phẩm mỗi trang"].map((item) => (
                  <div key={item} className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>{item}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-4">
            <div className={`rounded-[2rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Đã kết nối</p>
              <h3 className={`mt-4 text-2xl font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>/store, /store/products, /store/products/[slug]</h3>
            </div>
            <div className={`rounded-[2rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Hỗ trợ</p>
              <div className={`mt-4 space-y-3 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                <p>Dark mode</p>
                <p>Pagination 8 sản phẩm</p>
                <p>Kéo sản phẩm vào icon giỏ hàng</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionTitle title="Danh mục nổi bật" description="Các nhóm sản phẩm chính để đi vào listing nhanh hơn." />
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {storeCategories.map((category) => (
              <Link key={category.id} href={`/store/products?category=${encodeURIComponent(category.label)}`} className={`group relative overflow-hidden rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: category.accent }} />
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

      <ProductShowcase title="Bán chạy" products={bestSellerProducts} />
      <ProductShowcase title="Flash Pick" products={flashSaleProducts} />
      <ProductShowcase title="Newest" products={newArrivals} />
    </>
  );
}

export function SectionTitle({ title, description }: { title: string; description: string }) {
  const { theme } = useStorefront();
  const isDark = theme === "dark";
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-orange-500">Storefront</p>
      <h2 className={`mt-3 text-3xl font-semibold tracking-tight sm:text-4xl ${isDark ? "text-white" : "text-slate-950"}`}>{title}</h2>
      <p className={`mt-4 text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>{description}</p>
    </div>
  );
}

export function ProductShowcase({ title, products }: { title: string; products: StoreProduct[] }) {
  const { theme } = useStorefront();
  const isDark = theme === "dark";
  return (
    <section className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-end justify-between gap-4">
          <SectionTitle title={title} description="Các sản phẩm được nối trực tiếp vào route storefront trong dự án web." />
          <Link href="/store/products" className={`rounded-full border px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-300 bg-white text-slate-950"}`}>Xem toàn bộ</Link>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </div>
    </section>
  );
}

export function ProductsPageClient({
  category,
  sort
}: {
  category?: string;
  sort?: string;
}) {
  const { theme } = useStorefront();
  const isDark = theme === "dark";
  const [keyword, setKeyword] = useState("");
  const activeCategory = category ?? "Tất cả";
  const activeSort = sort ?? "newest";
  const itemsPerPage = 8;
  const [page, setPage] = useState(1);

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
        if (activeSort === "oldest") return String(left.updatedAt).localeCompare(String(right.updatedAt));
        if (activeSort === "price-asc") return left.price - right.price;
        if (activeSort === "price-desc") return right.price - left.price;
        if (activeSort === "best-seller") return right.soldCount - left.soldCount;
        return String(right.updatedAt).localeCompare(String(left.updatedAt));
      });
  }, [activeCategory, activeSort, keyword]);

  useEffect(() => {
    setPage(1);
  }, [keyword, activeCategory, activeSort]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedProducts = filteredProducts.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionTitle title="Danh sách sản phẩm theo hướng sàn thương mại điện tử" description="Trang sản phẩm đã được nối thẳng vào dự án Next hiện tại và mặc định hiển thị 8 sản phẩm mỗi trang." />
        <div className={`mt-8 rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Tìm sản phẩm</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Nhập tên, thương hiệu hoặc mô tả..." className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-slate-900 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`} />
            </label>
            <div className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Danh mục</span>
              <div className={`h-12 rounded-2xl border px-4 text-sm leading-[46px] ${isDark ? "border-white/10 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-950"}`}>{activeCategory}</div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Sắp xếp</span>
              <div className={`h-12 rounded-2xl border px-4 text-sm leading-[46px] ${isDark ? "border-white/10 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-950"}`}>{activeSort}</div>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>Hiển thị <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{paginatedProducts.length}</span> / <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{filteredProducts.length}</span> sản phẩm</p>
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>Trang <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{safePage}</span> / <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{totalPages}</span></p>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {paginatedProducts.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1} className={`rounded-full px-5 py-3 text-sm font-semibold ${safePage <= 1 ? "cursor-not-allowed bg-slate-200 text-slate-400" : isDark ? "bg-white/5 text-white" : "bg-white text-slate-950 shadow-sm"}`}>Trang trước</button>
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((value) => (
            <button key={value} type="button" onClick={() => setPage(value)} className={`h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${value === safePage ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "bg-white/5 text-slate-200" : "bg-white text-slate-700 shadow-sm"}`}>{value}</button>
          ))}
          <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages} className={`rounded-full px-5 py-3 text-sm font-semibold ${safePage >= totalPages ? "cursor-not-allowed bg-slate-200 text-slate-400" : isDark ? "bg-white/5 text-white" : "bg-white text-slate-950 shadow-sm"}`}>Trang sau</button>
        </div>
      </div>
    </section>
  );
}

export function ProductDetailClient({ slug }: { slug: string }) {
  const { theme, addCatalogItem } = useStorefront();
  const isDark = theme === "dark";
  const [quantity, setQuantity] = useState(1);
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<StoreProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      const productId = slug.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)?.[0];
      if (!productId) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      try {
        const [detail, listing] = await Promise.all([
          fetchStorefrontProductById(productId),
          fetchStorefrontProducts({ category: "all", limit: "12" })
        ]);
        if (!cancelled) {
          setProduct(detail);
          setRelatedProducts(
            listing.items.filter((item) => item.id !== detail.id && item.category === detail.category).slice(0, 4)
          );
        }
      } catch {
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-3xl rounded-[2rem] border p-10 text-center ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <p className="text-sm uppercase tracking-[0.3em] text-orange-500">Đang tải</p>
          <h1 className={`mt-4 text-3xl font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>Đang tải dữ liệu sản phẩm...</h1>
        </div>
      </section>
    );
  }

  if (!product) {
    return (
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-3xl rounded-[2rem] border p-10 text-center ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <p className="text-sm uppercase tracking-[0.3em] text-orange-500">Không tìm thấy</p>
          <h1 className={`mt-4 text-3xl font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>Sản phẩm không tồn tại trong storefront</h1>
          <Link href="/store/products" className="mt-6 inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">Quay lại danh sách</Link>
        </div>
      </section>
    );
  }

  const canAdd = product.status !== "out_of_stock";

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionTitle title={product.name} description="Trang chi tiết sản phẩm đã được nối trực tiếp vào web app hiện tại." />
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className={`overflow-hidden rounded-[2rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"}`}>
            <img src={product.imageUrl} alt={product.name} className="h-[28rem] w-full rounded-[1.75rem] object-cover sm:h-[36rem]" />
          </div>
          <div className={`rounded-[2rem] border p-6 sm:p-8 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">{product.category}</p>
            <h1 className={`mt-3 text-4xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{product.name}</h1>
            <p className={`mt-4 text-base leading-8 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{product.description}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {product.specs.map((spec) => <span key={spec} className={`rounded-full px-4 py-2 text-sm font-medium ${isDark ? "bg-white/8 text-slate-200" : "bg-slate-100 text-slate-600"}`}>{spec}</span>)}
            </div>
            <div className="mt-8 flex items-end gap-4">
              <strong className="text-4xl font-bold text-orange-500">{formatCurrency(product.price)}</strong>
              <span className="pb-1 text-lg text-slate-400 line-through">{formatCurrency(product.originalPrice)}</span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <InfoTile isDark={isDark} label="Đánh giá" value={`${product.rating} / 5`} />
              <InfoTile isDark={isDark} label="Đã bán" value={`${product.soldCount}+`} />
              <InfoTile isDark={isDark} label="Cập nhật" value={formatShortDate(product.updatedAt)} />
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <div className={`inline-flex items-center rounded-full border p-1 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} className="rounded-full p-3">-</button>
                <span className="min-w-12 text-center font-semibold">{quantity}</span>
                <button type="button" onClick={() => setQuantity((current) => Math.min(product.stock || 1, current + 1))} className="rounded-full p-3">+</button>
              </div>
              <button type="button" onClick={() => addCatalogItem(product, quantity)} disabled={!canAdd} className="inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400">{canAdd ? "Thêm vào giỏ hàng" : "Hết hàng"}</button>
            </div>
          </div>
        </div>
        <div className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Liên quan</p>
              <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>Cùng danh mục với sản phẩm này</h2>
            </div>
            <Link href="/store/products" className={`rounded-full border px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-300 bg-white text-slate-950"}`}>Xem catalog</Link>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {relatedProducts.map((item) => <ProductCard key={item.id} product={item} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoTile({ isDark, label, value }: { isDark: boolean; label: string; value: string }) {
  return (
    <div className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
      <div className={`text-sm ${isDark ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
      <p className={`mt-3 text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}
