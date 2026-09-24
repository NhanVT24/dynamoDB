"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { storeCategories, storeProducts } from "./store-data";
import { buildProductDetailHref, fetchStorefrontProductById, fetchStorefrontProducts, toStoreProduct } from "./store-api";
import ProductEditor from "./products/product-editor";
import {
  beginGoogleSignIn,
  confirmForgotPassword,
  confirmSignUpWithCognito,
  consumePostLoginRedirect,
  authSessionChangedEvent,
  authSessionEndedEvent,
  authenticatedFetch,
  readAuthSession,
  rememberPostLoginRedirect,
  resendConfirmationCode,
  signInWithCognito,
  signOutFromCognitoHostedUi,
  signUpWithCognito,
  forgotPassword,
  resolvePostLoginRoute,
  type AuthSession
} from "../lib/cognito-auth";
import type { CartItem, ManagedProduct, StoreProduct } from "./store-types";
import { calculateShipping, calculateSubtotal, formatCurrency, formatShortDate } from "./store-utils";

type ThemeMode = "light" | "dark";
type SortMode = "newest" | "oldest" | "price-asc" | "price-desc" | "best-seller";

type StoreContextValue = {
  session: AuthSession | null;
  setSession: (session: AuthSession | null) => void;
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
  isAuthModalOpen: boolean;
  authModalMessage?: string;
  openAuthModal: (redirectPath?: string) => void;
  closeAuthModal: () => void;
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

type PaginationToken = number | "ellipsis";

const StoreContext = createContext<StoreContextValue | null>(null);
const themeStorageKey = "web-storefront-theme";
const legacyCartStorageKey = "web-storefront-cart";
const guestCartStorageKey = "web-storefront-cart:guest";
const localNotificationsStorageKey = "web-storefront-local-notifications";
const notificationsUpdatedEvent = "storefront-notifications-updated";
const pendingCheckoutStorageKey = "web-storefront-pending-checkout";
const resumeCheckoutAfterLoginStorageKey = "web-storefront-resume-checkout-after-login";
const processedPaymentPrefix = "web-storefront-payment-processed-";
const pendingOrderRequestPrefix = "web-storefront-order-request-";
const managementApiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

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

function clearStorefrontSessionArtifacts() {
  if (typeof window === "undefined") {
    return;
  }

  // Keep account carts. A later account on this browser must never inherit
  // the previous account's private cart contents.
  const removableKeys = [legacyCartStorageKey, localNotificationsStorageKey, pendingCheckoutStorageKey];
  for (const key of removableKeys) {
    window.localStorage.removeItem(key);
  }

  const dynamicKeys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) {
      continue;
    }

    if (key.startsWith(processedPaymentPrefix) || key.startsWith(pendingOrderRequestPrefix)) {
      dynamicKeys.push(key);
    }
  }

  for (const key of dynamicKeys) {
    window.localStorage.removeItem(key);
  }

  window.dispatchEvent(new Event(notificationsUpdatedEvent));
}

type CartStorage = {
  key: string;
  storage: Storage;
};

function resolveCartStorage(session: AuthSession | null): CartStorage {
  if (!session) {
    // Guests do not have a stable identity. sessionStorage avoids showing a
    // guest cart to the next person after the shared browser is closed.
    return { key: guestCartStorageKey, storage: window.sessionStorage };
  }

  const owner = String(session.subject || session.email).trim().toLowerCase();
  return {
    key: `web-storefront-cart:user:${encodeURIComponent(owner)}`,
    storage: window.localStorage
  };
}

function readCart(storage: CartStorage): CartItem[] {
  const raw = storage.storage.getItem(storage.key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as CartItem[] : [];
  } catch {
    storage.storage.removeItem(storage.key);
    return [];
  }
}

function mergeCartItems(accountItems: CartItem[], guestItems: CartItem[]): CartItem[] {
  const mergedByVariant = new Map<string, CartItem>();

  for (const item of [...accountItems, ...guestItems]) {
    const variantId = String(item.variantId || item.productId).trim();
    if (!variantId) continue;

    const quantity = Math.max(1, Number(item.quantity) || 1);
    const stock = Math.max(0, Number(item.stock) || 0);
    const existing = mergedByVariant.get(variantId);

    if (!existing) {
      mergedByVariant.set(variantId, {
        ...item,
        variantId,
        quantity: stock > 0 ? Math.min(quantity, stock) : quantity,
        stock
      });
      continue;
    }

    const mergedStock = Math.max(existing.stock, stock);
    const mergedQuantity = existing.quantity + quantity;
    mergedByVariant.set(variantId, {
      ...existing,
      ...item,
      variantId,
      quantity: mergedStock > 0 ? Math.min(mergedQuantity, mergedStock) : mergedQuantity,
      stock: mergedStock
    });
  }

  return [...mergedByVariant.values()];
}

function mergeNotifications(localItems: StoreNotification[], serverItems: StoreNotification[]) {
  function buildNotificationKey(item: StoreNotification) {
    const metadata = (item as { metadata?: Record<string, unknown> }).metadata ?? {};
    const txnRef = String(metadata.txnRef ?? "").trim();
    const paymentStatus = String(metadata.paymentStatus ?? "").trim();
    const requestId = String(metadata.requestId ?? "").trim();
    const orderId = String(metadata.orderId ?? "").trim();

    if (txnRef && paymentStatus) {
      return `payment:${paymentStatus}:${txnRef}`;
    }

    if (requestId) {
      return `request:${requestId}`;
    }

    if (orderId && item.title) {
      return `order:${orderId}:${item.title}`;
    }

    return `id:${item.id}`;
  }

  const merged = new Map<string, StoreNotification>();

  for (const item of [...serverItems, ...localItems]) {
    const key = buildNotificationKey(item);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }

    const preferredServerItem = existing.source === "server"
      ? existing
      : item.source === "server"
        ? item
        : null;

    merged.set(key, {
      ...existing,
      ...item,
      id: preferredServerItem?.id ?? item.id,
      channel: preferredServerItem?.channel ?? item.channel,
      createdAt: preferredServerItem?.createdAt ?? item.createdAt,
      isRead: Boolean(existing.isRead || item.isRead),
      source: preferredServerItem ? "server" : (item.source ?? existing.source)
    });
  }

  return [...merged.values()].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
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

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [items, setItems] = useState<CartItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(undefined);
  const [hasHydratedCart, setHasHydratedCart] = useState(false);
  const [cartStorage, setCartStorage] = useState<CartStorage | null>(null);
  const itemsRef = useRef<CartItem[]>([]);
  const cartStorageRef = useRef<CartStorage | null>(null);
  const hasHydratedCartRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  function switchCartOwner(session: AuthSession | null) {
    const nextStorage = resolveCartStorage(session);
    const currentStorage = cartStorageRef.current;

    if (currentStorage?.key === nextStorage.key && currentStorage.storage === nextStorage.storage) {
      return;
    }

    if (currentStorage && hasHydratedCartRef.current) {
      currentStorage.storage.setItem(currentStorage.key, JSON.stringify(itemsRef.current));
    }

    cartStorageRef.current = nextStorage;
    setCartStorage(nextStorage);

    let nextItems = readCart(nextStorage);
    if (session) {
      const guestStorage: CartStorage = { key: guestCartStorageKey, storage: window.sessionStorage };
      const guestItems = readCart(guestStorage);
      if (guestItems.length > 0) {
        nextItems = mergeCartItems(nextItems, guestItems);
        nextStorage.storage.setItem(nextStorage.key, JSON.stringify(nextItems));
        guestStorage.storage.removeItem(guestStorage.key);
      }
    }

    setItems(nextItems);
    hasHydratedCartRef.current = true;
    setHasHydratedCart(true);
  }

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    } else {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }

    // A global legacy cart has no provable owner, so do not migrate it into
    // any account cart. Keeping it would leak one shopper's choices.
    window.localStorage.removeItem(legacyCartStorageKey);
    const currentSession = readAuthSession();
    setSession(currentSession);
    switchCartOwner(currentSession);

    const syncAuthState = () => {
      const nextSession = readAuthSession();
      setSession(nextSession);
      switchCartOwner(nextSession);
    };
    const handleSessionEnded = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const message = detail?.message || "";
      setSession(null);
      setAuthModalMessage(/expired|session has ended/i.test(message) ? "Please sign in to view this page." : message || "Please sign in to view this page.");
      setIsDrawerOpen(false);
      setIsAuthModalOpen(true);
    };
    window.addEventListener(authSessionChangedEvent, syncAuthState);
    window.addEventListener(authSessionEndedEvent, handleSessionEnded);
    return () => {
      window.removeEventListener(authSessionChangedEvent, syncAuthState);
      window.removeEventListener(authSessionEndedEvent, handleSessionEnded);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.storeTheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!hasHydratedCart || !cartStorage) {
      return;
    }
    cartStorage.storage.setItem(cartStorage.key, JSON.stringify(items));
  }, [cartStorage, hasHydratedCart, items]);

  function addCatalogItem(product: StoreProduct, quantity: number) {
    if (product.status === "out_of_stock" || product.isLocked) {
      return;
    }

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

  function openAuthModal(redirectPath?: string) {
    if (redirectPath) {
      rememberPostLoginRedirect(redirectPath);
    }
    setAuthModalMessage(undefined);
    setIsAuthModalOpen(true);
  }

  function closeAuthModal() {
    setIsAuthModalOpen(false);
    setAuthModalMessage(undefined);
  }

  const subtotal = useMemo(() => calculateSubtotal(items), [items]);
  const shipping = useMemo(() => calculateShipping(items), [items]);
  const total = subtotal + shipping;
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <StoreContext.Provider
      value={{
        session,
        setSession,
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
        toggleDrawer,
        isAuthModalOpen,
        authModalMessage,
        openAuthModal,
        closeAuthModal
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

function CartDrawer({ session }: { session: AuthSession | null }) {
  const { items, isDrawerOpen, toggleDrawer, updateQuantity, removeItem, subtotal, shipping, total, clearCart, theme, openAuthModal } = useStorefront();
  const isDark = theme === "dark";

  if (!isDrawerOpen) return null;

  return (
    <>
      <button className="fixed inset-0 z-40 bg-slate-950/55" onClick={() => toggleDrawer(false)} />
      <aside className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l p-6 ${isDark ? "border-white/10 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950"}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-500">Cart</p>
            <h3 className="mt-2 text-2xl font-semibold">Quick shopping</h3>
          </div>
          <button className="rounded-2xl border px-3 py-2" onClick={() => toggleDrawer(false)}>Close</button>
        </div>
        <div className="mt-6 flex-1 space-y-4 overflow-y-auto pr-2">
          {items.length === 0 ? (
            <div className={`rounded-[1.5rem] border border-dashed p-6 text-sm ${isDark ? "border-white/10 bg-white/5 text-slate-300" : "border-slate-300 bg-slate-50 text-slate-600"}`}>
              Your cart is empty.
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
                    <button onClick={() => removeItem(item.variantId)} className="text-sm text-rose-500">Remove</button>
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
          <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
          <div className="mt-2 flex justify-between text-sm"><span>Shipping</span><span>{shipping === 0 ? "Free" : formatCurrency(shipping)}</span></div>
          <div className="mt-4 flex justify-between border-t border-white/20 pt-4 text-lg font-semibold"><span>Total</span><span>{formatCurrency(total)}</span></div>
          <div className="mt-4 grid gap-3">
            <button onClick={clearCart} className="rounded-full border border-white/20 px-4 py-3 font-semibold">Clear cart</button>
            {session ? (
              <Link
                href="/store/checkout"
                onClick={() => toggleDrawer(false)}
                className="rounded-full bg-white px-4 py-3 text-center font-semibold text-orange-600"
              >
                Sandbox checkout
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  toggleDrawer(false);
                  window.sessionStorage.setItem(resumeCheckoutAfterLoginStorageKey, "1");
                  openAuthModal("/store/checkout");
                }}
                className="rounded-full bg-white px-4 py-3 text-center font-semibold text-orange-600"
              >
                Sign in to checkout
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function PasswordField({
  id,
  label,
  value,
  placeholder,
  isVisible,
  isDark,
  onChange,
  onToggle
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  isVisible: boolean;
  isDark: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  return (
    <label className="grid gap-2" htmlFor={id}>
      <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>{label}</span>
      <div className="relative">
        <input
          id={id}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={`h-12 w-full rounded-2xl border px-4 pr-20 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
          required
        />
        <button
          type="button"
          aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={isVisible}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggle}
          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-xl px-3 py-1.5 text-xs font-semibold ${isDark ? "bg-white/10 text-white hover:bg-white/15" : "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"}`}
        >
          {isVisible ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

function StorefrontAuthModal({
  session,
  onSignedIn
}: {
  session: AuthSession | null;
  onSignedIn: (nextSession: AuthSession) => void;
}) {
  const router = useRouter();
  const { isAuthModalOpen, authModalMessage, closeAuthModal, theme } = useStorefront();
  const isDark = theme === "dark";
  const [mode, setMode] = useState<"login" | "register" | "confirm" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("Sign in to continue shopping or start checkout.");
  const [resendCountdown, setResendCountdown] = useState(0);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isRegisterPasswordVisible, setIsRegisterPasswordVisible] = useState(false);
  const [isRegisterConfirmPasswordVisible, setIsRegisterConfirmPasswordVisible] = useState(false);
  const [isResetPasswordVisible, setIsResetPasswordVisible] = useState(false);
  const [isResetConfirmPasswordVisible, setIsResetConfirmPasswordVisible] = useState(false);

  useEffect(() => {
    if (!isAuthModalOpen) return;
    setMode("login");
    setMessage(authModalMessage || "Sign in to continue shopping or start checkout.");
    setIsPasswordVisible(false);
    setIsRegisterPasswordVisible(false);
    setIsRegisterConfirmPasswordVisible(false);
    setIsResetPasswordVisible(false);
    setIsResetConfirmPasswordVisible(false);
  }, [authModalMessage, isAuthModalOpen]);

  useEffect(() => {
    if (!isAuthModalOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeAuthModal();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeAuthModal, isAuthModalOpen]);

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setResendCountdown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [resendCountdown]);

  if (!isAuthModalOpen || session) {
    return null;
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const nextSession = await signInWithCognito({
        email,
        password
      });

      onSignedIn(nextSession);
      closeAuthModal();
      router.push(resolvePostLoginRoute(nextSession, consumePostLoginRedirect()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not sign you in right now.");
      if (error instanceof Error && /confirm/i.test(error.message)) {
        setConfirmEmail(email);
        setMode("confirm");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (registerPassword.length < 8) {
        throw new Error("The password must contain at least 8 characters.");
      }

      if (registerPassword !== registerConfirmPassword) {
        throw new Error("The confirmation password does not match.");
      }

      await signUpWithCognito({
        email: registerEmail,
        password: registerPassword,
        name: registerName
      });

      setConfirmEmail(registerEmail);
      setEmail(registerEmail);
      setPassword(registerPassword);
      setResendCountdown(60);
      setMode("confirm");
      setMessage("Your account was created successfully. Please check your email for the confirmation code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not create the account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await confirmSignUpWithCognito({
        email: confirmEmail,
        code: confirmCode
      });

      setMode("login");
      setEmail(confirmEmail);
      setMessage("Your email has been confirmed. You can sign in now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not confirm the account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await forgotPassword(forgotEmail);
      setResetCode("");
      setResetPassword("");
      setResetConfirmPassword("");
      setMode("reset");
      setMessage("A password reset code was sent to your email.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not start the password reset flow.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (resetPassword.length < 8) {
        throw new Error("The new password must contain at least 8 characters.");
      }

      if (resetPassword !== resetConfirmPassword) {
        throw new Error("The confirmation password does not match.");
      }

      await confirmForgotPassword({
        email: forgotEmail,
        code: resetCode,
        newPassword: resetPassword
      });

      setMode("login");
      setEmail(forgotEmail);
      setPassword("");
      setMessage("Your password was reset successfully. Please sign in with the new password.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not reset the password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    if (resendCountdown > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      await resendConfirmationCode(confirmEmail);
      setResendCountdown(60);
      setMessage("A new confirmation code has been sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not resend the confirmation code.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const titleByMode = {
    login: "Sign in",
    register: "Create account",
    confirm: "Confirm email",
    forgot: "Forgot password",
    reset: "Reset password"
  } as const;

  function renderAuthMessageTone() {
    const lowered = message.toLowerCase();
    const isError =
      lowered.includes("cannot") ||
      lowered.includes("could not") ||
      lowered.includes("failed") ||
      lowered.includes("invalid") ||
      lowered.includes("incorrect") ||
      lowered.includes("expired") ||
      lowered.includes("mismatch") ||
      lowered.includes("does not") ||
      lowered.includes("must") ||
      lowered.includes("policy") ||
      lowered.includes("error");

    if (isError) {
      return isDark
        ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
        : "border-rose-200 bg-rose-50 text-rose-700";
    }

    const isSuccess =
      lowered.includes("success") ||
      lowered.includes("created") ||
      lowered.includes("confirmed") ||
      lowered.includes("sent") ||
      lowered.includes("reset successfully");

    if (isSuccess) {
      return isDark
        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";
    }

    return isDark
      ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"
      : "border-cyan-200 bg-cyan-50 text-cyan-700";
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close sign-in dialog"
        onClick={closeAuthModal}
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
      />
      <section className={`relative z-[81] w-full max-w-md rounded-[2rem] border p-6 shadow-[0_30px_100px_rgba(15,23,42,0.25)] ${isDark ? "border-white/10 bg-[#101826] text-white" : "border-slate-200 bg-white text-slate-950"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">Account</p>
            <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{titleByMode[mode]}</h2>
          </div>
          <button
            type="button"
            onClick={closeAuthModal}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-lg ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
          >
            ×
          </button>
        </div>

        <p className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${renderAuthMessageTone()}`}>
          {message}
        </p>

        {mode === "login" ? (
          <form className="mt-5 grid gap-4" onSubmit={handleLogin}>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
                required
              />
            </label>
            <PasswordField
              id="storefront-login-password"
              label="Password"
              value={password}
              placeholder="Enter your password"
              isVisible={isPasswordVisible}
              isDark={isDark}
              onChange={setPassword}
              onToggle={() => setIsPasswordVisible((current) => !current)}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => beginGoogleSignIn()}
              className={`inline-flex h-12 items-center justify-center rounded-2xl border px-4 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
            >
              Sign in with Google
            </button>
          </form>
        ) : null}

        {mode === "register" ? (
          <form className="mt-5 grid gap-4" onSubmit={handleRegister}>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Full name</span>
              <input
                value={registerName}
                onChange={(event) => setRegisterName(event.target.value)}
                placeholder="Example: Alex Nguyen"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
              />
            </label>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Email</span>
              <input
                type="email"
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                placeholder="you@example.com"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
                required
              />
            </label>
            <PasswordField
              id="storefront-register-password"
              label="Password"
              value={registerPassword}
              placeholder="At least 8 characters"
              isVisible={isRegisterPasswordVisible}
              isDark={isDark}
              onChange={setRegisterPassword}
              onToggle={() => setIsRegisterPasswordVisible((current) => !current)}
            />
            <PasswordField
              id="storefront-register-confirm-password"
              label="Confirm password"
              value={registerConfirmPassword}
              placeholder="Re-enter your password"
              isVisible={isRegisterConfirmPasswordVisible}
              isDark={isDark}
              onChange={setRegisterConfirmPassword}
              onToggle={() => setIsRegisterConfirmPasswordVisible((current) => !current)}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
            {isSubmitting ? "Creating account..." : "Create account"}
            </button>
          </form>
        ) : null}

        {mode === "confirm" ? (
          <form className="mt-5 grid gap-4" onSubmit={handleConfirm}>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Email</span>
              <input
                type="email"
                value={confirmEmail}
                onChange={(event) => setConfirmEmail(event.target.value)}
                placeholder="Email you just registered"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
                required
              />
            </label>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Confirmation code</span>
              <input
                value={confirmCode}
                onChange={(event) => setConfirmCode(event.target.value)}
                placeholder="Enter the 6-digit code from your email"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
                required
              />
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Confirming..." : "Confirm account"}
            </button>
            <button
              type="button"
              onClick={() => void handleResendCode()}
              disabled={isSubmitting || resendCountdown > 0}
              className={`inline-flex h-12 items-center justify-center rounded-2xl border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
            >
              {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : "Resend code"}
            </button>
          </form>
        ) : null}

        {mode === "forgot" ? (
          <form className="mt-5 grid gap-4" onSubmit={handleForgotPassword}>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Email</span>
              <input
                type="email"
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                placeholder="Enter your email"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
                required
              />
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Sending code..." : "Send reset code"}
            </button>
          </form>
        ) : null}

        {mode === "reset" ? (
          <form className="mt-5 grid gap-4" onSubmit={handleResetPassword}>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Email</span>
              <input
                type="email"
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                placeholder="Email for password reset"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
                required
              />
            </label>
            <label className="grid gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Reset code</span>
              <input
                value={resetCode}
                onChange={(event) => setResetCode(event.target.value)}
                placeholder="Enter the code from your email"
                className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-white/5 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`}
                required
              />
            </label>
            <PasswordField
              id="storefront-reset-password"
              label="New password"
              value={resetPassword}
              placeholder="Enter a new password"
              isVisible={isResetPasswordVisible}
              isDark={isDark}
              onChange={setResetPassword}
              onToggle={() => setIsResetPasswordVisible((current) => !current)}
            />
            <PasswordField
              id="storefront-reset-confirm-password"
              label="Confirm new password"
              value={resetConfirmPassword}
              placeholder="Re-enter the new password"
              isVisible={isResetConfirmPasswordVisible}
              isDark={isDark}
              onChange={setResetConfirmPassword}
              onToggle={() => setIsResetConfirmPasswordVisible((current) => !current)}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Updating..." : "Update password"}
            </button>
          </form>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          {mode !== "register" ? (
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${isDark ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100" : "border-cyan-200 bg-cyan-50 text-cyan-700"}`}
            >
              Create account
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
            >
              Back to sign in
            </button>
          )}
          {mode !== "forgot" && mode !== "reset" ? (
            <button
              type="button"
              onClick={() => {
                setForgotEmail(email || registerEmail || confirmEmail);
                setMode("forgot");
              }}
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
            >
              Forgot password
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
            >
              Back to sign in
            </button>
          )}
        </div>
      </section>
    </div>
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
      if (!session?.idToken) {
        if (!cancelled) {
          // Notifications belong to an authenticated account. Local payment
          // feedback must never remain visible after logout or token expiry.
          setNotifications([]);
          setPendingCount(0);
        }
        return;
      }

      const localItems = readLocalNotifications();

      try {
        const response = await authenticatedFetch("/api/lambda-proxy/api/notifications/me", {
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
        const mergedItems = mergeNotifications(localItems, serverItems);

        setNotifications(mergedItems);
        setPendingCount(mergedItems.filter((item) => !item.isRead).length);
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
      const response = await authenticatedFetch(`/api/lambda-proxy/api/notifications/${item.id}/read`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.idToken}`
        }
      });

      if (!response.ok) {
        throw new Error("We could not mark the notification as read.");
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
      const response = await authenticatedFetch(`/api/lambda-proxy/api/notifications/${item.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.idToken}`
        }
      });

      if (!response.ok) {
        throw new Error("We could not delete the notification.");
      }

      setNotifications((current) => current.filter((entry) => entry.id !== item.id));
      setPendingCount((current) => Math.max(0, current - (!item.isRead ? 1 : 0)));
    } catch {}
  }

  async function handleDeleteAllNotifications() {
    if (notifications.length === 0) {
      return;
    }

    const hasLocalItems = notifications.some((item) => item.source === "local" || !session?.idToken);
    if (hasLocalItems) {
      writeLocalNotifications([]);
    }

    const serverItems = notifications.filter((item) => item.source !== "local");
    if (session?.idToken && serverItems.length > 0) {
      try {
        const response = await authenticatedFetch("/api/lambda-proxy/api/notifications", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.idToken}`
          }
        });

        if (!response.ok) {
          throw new Error("We could not delete all notifications.");
        }
      } catch {
        return;
      }
    }

    setNotifications([]);
    setPendingCount(0);
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
          const response = await authenticatedFetch(`/api/lambda-proxy/api/notifications/${item.id}/read`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${session.idToken}`
            }
          });

          if (!response.ok) {
            throw new Error("We could not mark all notifications as read.");
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

  if (!session?.idToken) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Open notifications"
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition-colors ${
          isDark
            ? "border-white/10 bg-white/5 text-white hover:bg-white/10"
            : "border-slate-900 bg-white text-slate-900 hover:bg-slate-100"
        }`}
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
        <div className={`absolute right-0 mt-3 w-[26rem] max-w-[calc(100vw-1.5rem)] rounded-[1.5rem] border p-4 shadow-2xl ${isDark ? "border-white/10 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950"}`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Notifications</p>
            <span className="text-xs text-orange-500">{pendingCount} unread</span>
          </div>
          {notifications.length > 0 ? (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleDeleteAllNotifications()}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isDark ? "bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 hover:text-white" : "bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700"}`}
              >
                Delete all
              </button>
              <button
                type="button"
                onClick={() => void handleMarkAllAsRead()}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isDark ? "bg-white/10 text-slate-200 hover:bg-white/15 hover:text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"}`}
              >
                Mark all as read
              </button>
            </div>
          ) : null}
          <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {notifications.length === 0 ? (
              <div className={`rounded-2xl border border-dashed p-4 text-sm ${isDark ? "border-white/10 text-slate-300" : "border-slate-200 text-slate-500"}`}>
                No notifications yet.
              </div>
            ) : notifications.map((item) => (
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
                      Mark as read
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDeleteNotification(item)}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isDark ? "bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 hover:text-white" : "bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700"}`}
                  >
                    Delete
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

function getDiscountTone(discountPercent: number) {
  if (discountPercent >= 50) return { badge: "bg-rose-600 text-white" };
  if (discountPercent >= 30) return { badge: "bg-violet-600 text-white" };
  if (discountPercent >= 15) return { badge: "bg-amber-400 text-amber-950" };
  return { badge: "bg-cyan-600 text-white" };
}

function getCountdownParts(endsAt: string | undefined, now = Date.now()) {
  const endsAtMs = endsAt ? new Date(endsAt).getTime() : Number.NaN;
  const remainingMs = Math.max(0, endsAtMs - now);
  if (!Number.isFinite(endsAtMs) || remainingMs <= 0) {
    return null;
  }

  const totalSeconds = Math.floor(remainingMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

function SaleCountdown({ endsAt, isDark }: { endsAt?: string; isDark: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  const parts = now === null ? undefined : getCountdownParts(endsAt, now);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  if (now === null) {
    return <p className="mt-3 text-xs font-semibold text-slate-400">Ends in --</p>;
  }

  if (!parts) {
    return <p className="mt-3 text-xs font-semibold text-slate-400">Offer ended</p>;
  }

  const values = [
    ...(parts.days > 0 ? [{ label: "d", value: String(parts.days) }] : []),
    { label: "h", value: String(parts.hours).padStart(2, "0") },
    { label: "m", value: String(parts.minutes).padStart(2, "0") },
    { label: "s", value: String(parts.seconds).padStart(2, "0") }
  ];

  return (
    <div className={`mt-3 flex items-center gap-1.5 text-[11px] font-bold tabular-nums ${isDark ? "text-rose-200" : "text-rose-700"}`} aria-label={`Sale ends in ${values.map((item) => `${item.value}${item.label}`).join(" ")}`}>
      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">Ends in</span>
      {values.map((item) => <span key={item.label} className={`rounded-md px-1.5 py-1 ${isDark ? "bg-rose-500/15" : "bg-rose-100"}`}>{item.value}{item.label}</span>)}
    </div>
  );
}

function ProductCard({ product }: { product: StoreProduct }) {
  const { addCatalogItem, theme } = useStorefront();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isDark = theme === "dark";
  const discountPercent = Math.max(0, Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100));
  const hasDiscount = discountPercent > 0;
  const discountTone = getDiscountTone(discountPercent);
  const isUnavailable = product.status === "out_of_stock" || product.isLocked;

  function handleDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-store-product-id", product.id);
    event.dataTransfer.setData("application/x-store-product", JSON.stringify(product));
    event.dataTransfer.setData("text/plain", product.name);
    if (imageRef.current) event.dataTransfer.setDragImage(imageRef.current, 64, 64);
  }

  return (
    <article
      draggable={!isUnavailable}
      onDragStartCapture={handleDragStart}
      className={`group relative overflow-hidden rounded-[1.75rem] border ${isDark ? "border-white/10 bg-slate-900/85" : "border-slate-200 bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.35)]"} ${isUnavailable ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
    >
      <Link href={buildProductDetailHref(product.slug)} className="absolute inset-0 z-10" aria-label={product.name} />
      <div className="relative overflow-hidden">
        <img ref={imageRef} src={product.imageUrl} alt={product.name} className="h-64 w-full object-cover transition duration-500 group-hover:scale-105" draggable={false} />
        <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 pt-4 transition duration-300 group-hover:opacity-0">
          {hasDiscount ? <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${discountTone.badge}`}>-{discountPercent}%</span> : <span />}
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "bg-white/10 text-slate-200" : "bg-white/90 text-slate-700"}`}>{product.category}</span>
        </div>
        <div className="absolute inset-0 z-20 bg-slate-950/0 transition duration-300 group-hover:bg-slate-950/72" />
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center opacity-0 transition duration-300 group-hover:opacity-100">
          <p className="line-clamp-4 text-sm font-medium leading-6 text-white/90">{product.description}</p>
          <div className="mt-5">
            {hasDiscount ? <div className="text-sm text-white/70 line-through">{formatCurrency(product.originalPrice)}</div> : null}
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
            {product.isLocked ? "Reserved" : isUnavailable ? "Out of stock" : "Add to cart"}
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
          <span className={`rounded-full px-2.5 py-1 ${isDark ? "bg-white/8 text-slate-300" : "bg-slate-100 text-slate-600"}`}>Sold {product.soldCount}</span>
        </div>
        <div className="mt-4">
          {hasDiscount ? <div className="text-[13px] text-slate-400 line-through">{formatCurrency(product.originalPrice)}</div> : null}
          <strong className="text-2xl font-bold text-rose-600">{formatCurrency(product.price)}</strong>
        </div>
        {product.isLocked ? (
          <p className="mt-3 text-sm font-medium text-amber-600">This product is temporarily reserved. Please try again later.</p>
        ) : null}
      </div>
    </article>
  );
}

export function StorefrontShell({ children }: { children: ReactNode }) {
  const { session, setSession, theme, toggleTheme, count, toggleDrawer, addCatalogItem, theme: currentTheme, openAuthModal } = useStorefront();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isDark = theme === "dark";
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isHomeRoute = normalizedPathname === "/" || normalizedPathname === "/store";
  const isProductsRoute = normalizedPathname === "/store/products" || normalizedPathname.startsWith("/store/products/");
  const isOrdersRoute = normalizedPathname === "/store/orders" || normalizedPathname.startsWith("/store/orders/");
  const isProfileRoute = normalizedPathname === "/store/profile" || normalizedPathname.startsWith("/store/profile/");
  const [isCartDropActive, setIsCartDropActive] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("auth") !== "login") {
      return;
    }

    // /admin sends unauthenticated visitors here so the existing modal handles login in place.
    openAuthModal("/admin");
    router.replace("/store", { scroll: false });
  }, [openAuthModal, router, searchParams]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobileMenuOpen]);

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
    clearStorefrontSessionArtifacts();
    signOutFromCognitoHostedUi();
  }

  return (
    <div className={`${isDark ? "bg-[#0b1220] text-slate-100" : "bg-[linear-gradient(180deg,_#f6f8fc_0%,_#eef3ff_26%,_#ffffff_100%)] text-slate-950"} min-h-screen transition-colors duration-300`}>
      <header className={`relative sticky top-0 z-40 border-b backdrop-blur-xl ${isDark ? "border-white/10 bg-slate-950/85" : "border-slate-200 bg-white/92"}`}>
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link href="/store" className="flex min-w-0 items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 text-sm font-bold tracking-[0.28em] text-white">NX</div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-orange-500">NovaX Market</p>
                <p className={`truncate text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>Storefront client integrated into the web app</p>
              </div>
            </Link>
            <nav className={`hidden items-center gap-2 rounded-full p-1 lg:flex ${isDark ? "bg-white/5" : "bg-slate-100"}`}>
              <Link href="/store" className={`rounded-full px-5 py-2.5 text-sm font-medium ${isHomeRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "text-slate-300 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>Home</Link>
              <Link href="/store/products" className={`rounded-full px-5 py-2.5 text-sm font-medium ${isProductsRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "text-slate-300 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>Products</Link>
              <Link href="/store/orders" className={`rounded-full px-5 py-2.5 text-sm font-medium ${isOrdersRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "text-slate-300 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>Orders</Link>
              <Link href="/store/profile" className={`rounded-full px-5 py-2.5 text-sm font-medium ${isProfileRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "text-slate-300 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>Profile</Link>
              {session?.role === "admin" ? (
                <Link href="/admin" className={`rounded-full px-5 py-2.5 text-sm font-medium ${isDark ? "bg-cyan-400/12 text-cyan-200 hover:bg-cyan-400/20" : "bg-cyan-50 text-cyan-700 hover:bg-cyan-100"}`}>Admin Console</Link>
              ) : null}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden sm:block"><NotificationBell session={session} isDark={isDark} /></div>
              {session ? (
                <div className="hidden items-center gap-2 lg:flex">
                  <Link href={session.role === "admin" ? "/admin" : "/store/profile"} className={`rounded-2xl px-4 py-2 text-right no-underline ${isDark ? "bg-white/5 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
                    <p className="max-w-40 truncate text-sm font-semibold">{session.name}</p>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${session.role === "admin" ? "text-cyan-500" : "text-orange-500"}`}>
                      {session.role === "admin" ? "Admin" : "Customer"}
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={handleStorefrontLogout}
                    className={`inline-flex h-11 items-center justify-center rounded-2xl border px-4 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal(normalizedPathname.startsWith("/store") ? normalizedPathname : "/store")}
                  className={`hidden h-11 items-center justify-center rounded-2xl border px-4 text-sm font-semibold lg:inline-flex ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  Sign in
                </button>
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
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((current) => !current)}
                aria-expanded={isMobileMenuOpen}
                aria-controls="storefront-mobile-navigation"
                aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border lg:hidden ${isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-700"}`}
              >
                {isMobileMenuOpen ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
                    <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        {isMobileMenuOpen ? (
          <div id="storefront-mobile-navigation" className={`absolute inset-x-0 top-full border-b px-4 py-4 shadow-2xl lg:hidden ${isDark ? "border-white/10 bg-slate-950" : "border-slate-200 bg-white"}`}>
            <nav aria-label="Storefront navigation" className="grid gap-2">
              <Link onClick={() => setIsMobileMenuOpen(false)} href="/store" className={`rounded-2xl px-4 py-3 text-sm font-semibold ${isHomeRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "bg-white/5 text-slate-200 hover:bg-white/10" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>Home</Link>
              <Link onClick={() => setIsMobileMenuOpen(false)} href="/store/products" className={`rounded-2xl px-4 py-3 text-sm font-semibold ${isProductsRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "bg-white/5 text-slate-200 hover:bg-white/10" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>Products</Link>
              <Link onClick={() => setIsMobileMenuOpen(false)} href="/store/orders" className={`rounded-2xl px-4 py-3 text-sm font-semibold ${isOrdersRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "bg-white/5 text-slate-200 hover:bg-white/10" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>Orders</Link>
              <Link onClick={() => setIsMobileMenuOpen(false)} href="/store/profile" className={`rounded-2xl px-4 py-3 text-sm font-semibold ${isProfileRoute ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "bg-white/5 text-slate-200 hover:bg-white/10" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>Profile</Link>
              {session?.role === "admin" ? (
                <Link onClick={() => setIsMobileMenuOpen(false)} href="/admin" className={`rounded-2xl px-4 py-3 text-sm font-semibold ${isDark ? "bg-cyan-400/12 text-cyan-200 hover:bg-cyan-400/20" : "bg-cyan-50 text-cyan-700 hover:bg-cyan-100"}`}>Admin Console</Link>
              ) : null}
            </nav>
            <div className={`mt-4 border-t pt-4 ${isDark ? "border-white/10" : "border-slate-200"}`}>
              {session ? (
                <div className="flex items-center justify-between gap-3">
                  <Link onClick={() => setIsMobileMenuOpen(false)} href={session.role === "admin" ? "/admin" : "/store/profile"} className="min-w-0">
                    <p className="truncate text-sm font-semibold">{session.name}</p>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${session.role === "admin" ? "text-cyan-500" : "text-orange-500"}`}>{session.role === "admin" ? "Admin" : "Customer"}</p>
                  </Link>
                  <button type="button" onClick={() => { handleStorefrontLogout(); setIsMobileMenuOpen(false); }} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}>Sign out</button>
                </div>
              ) : (
                <button type="button" onClick={() => { setIsMobileMenuOpen(false); openAuthModal(normalizedPathname.startsWith("/store") ? normalizedPathname : "/store"); }} className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"}`}>Sign in</button>
              )}
            </div>
          </div>
        ) : null}
        <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 px-4 py-2 text-center text-xs font-medium text-white">The storefront client runs on /store, while the admin area lives on /admin.</div>
      </header>
      <CartDrawer session={session} />
      <StorefrontAuthModal session={session} onSignedIn={setSession} />
      <main>{children}</main>
    </div>
  );
}

export function HomeSections() {
  const { theme } = useStorefront();
  const isDark = theme === "dark";
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saleRefreshVersion, setSaleRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      try {
        const data = await fetchStorefrontProducts();
        if (!cancelled) setProducts(data.items);
      } catch {}
      finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, [saleRefreshVersion]);

  const bestSellerProducts = [...products].sort((a, b) => b.soldCount - a.soldCount).slice(0, 8);
  const flashSaleProducts = [...products].sort((a, b) => (b.originalPrice - b.price) - (a.originalPrice - a.price)).slice(0, 4);
  const activeSaleProducts = products
    .filter((product) => Boolean(product.saleCampaignId) && product.price < product.originalPrice && product.status !== "out_of_stock")
    .sort((left, right) => Number(right.saleDiscountPercent ?? 0) - Number(left.saleDiscountPercent ?? 0));
  const newArrivals = [...products].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8);

  useEffect(() => {
    const nextEndAt = activeSaleProducts
      .map((product) => new Date(product.saleEndsAt ?? "").getTime())
      .filter((value) => Number.isFinite(value) && value > Date.now())
      .sort((left, right) => left - right)[0];

    if (!nextEndAt) {
      return;
    }

    const timeout = window.setTimeout(() => setSaleRefreshVersion((version) => version + 1), Math.max(1_000, nextEndAt - Date.now() + 1_000));
    return () => window.clearTimeout(timeout);
  }, [activeSaleProducts]);

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <section className="px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
              <div className={`rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 lg:px-10 ${isDark ? "bg-[#101826]" : "bg-white"}`}>
                <div className={`h-10 w-48 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`mt-5 h-14 w-5/6 rounded-[1.5rem] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`mt-3 h-14 w-4/5 rounded-[1.5rem] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className="mt-5 grid gap-3">
                  <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`h-4 w-11/12 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`h-4 w-3/4 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
                <div className="mt-7 flex flex-wrap gap-3">
                  <div className={`h-12 w-32 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`h-12 w-36 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className={`h-16 rounded-[1.5rem] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-4">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className={`rounded-[2rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
                  <div className={`h-4 w-24 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-4 h-10 w-4/5 rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className="mt-4 grid gap-3">
                    <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                    <div className={`h-4 w-3/4 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-3">
              <div className={`h-4 w-24 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-10 w-72 rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-4 w-96 max-w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className={`rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start gap-4">
                    <div className={`h-24 w-24 rounded-3xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                    <div className="flex-1">
                      <div className={`h-7 w-32 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                      <div className="mt-3 grid gap-2">
                        <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                        <div className={`h-4 w-5/6 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {["Best sellers", "Flash Pick", "Newest"].map((title) => (
          <section key={title} className="px-4 py-8 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="flex items-end justify-between gap-4">
                <div className="grid gap-3">
                  <div className={`h-4 w-24 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`h-10 w-56 rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`h-4 w-80 max-w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
                <div className={`h-12 w-32 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              </div>
              <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`overflow-hidden rounded-[1.75rem] border ${isDark ? "border-white/10 bg-slate-900/85" : "border-slate-200 bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.35)]"}`}>
                    <div className={`h-64 w-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                    <div className="p-4">
                      <div className={`h-3 w-24 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                      <div className={`mt-3 h-6 w-4/5 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                      <div className={`mt-2 h-6 w-2/3 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                      <div className="mt-4 grid gap-2">
                        <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                        <div className={`h-4 w-5/6 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <>
      <section className="px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
            <div className={`rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 lg:px-10 ${isDark ? "bg-[#101826]" : "bg-white"}`}>
              <div className="inline-flex rounded-full bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-orange-600">Today&apos;s tech deals</div>
              <h1 className={`mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl ${isDark ? "text-white" : "text-slate-950"}`}>The storefront client is wired into this project so you can test purchases directly.</h1>
              <p className={`mt-5 max-w-2xl text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>This flow runs inside the Next app at /store, while admin stays at /admin, with dark mode, drag-and-drop cart support, and a dedicated product listing.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/store/products" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">Shop now</Link>
                <Link href="/store/products" className={`rounded-full border px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10 text-white" : "border-slate-200 text-slate-800"}`}>Browse catalog</Link>
              </div>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {["24+ mock products", "6 main categories", "8 products per page"].map((item) => (
                  <div key={item} className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>{item}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-4">
            <div className={`rounded-[2rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Connected</p>
              <h3 className={`mt-4 text-2xl font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>/store, /store/products, /store/products/detail</h3>
            </div>
            <div className={`rounded-[2rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Highlights</p>
              <div className={`mt-4 space-y-3 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                <p>Dark mode</p>
                <p>Pagination with 8 products per page</p>
                <p>Drag products onto the cart icon</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {activeSaleProducts.length > 0 ? <SaleSpotlight products={activeSaleProducts} /> : null}

      <section className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionTitle title="Featured categories" description="Jump into the main shopping groups faster." />
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

      <ProductShowcase title="Best sellers" products={bestSellerProducts} />
      <ProductShowcase title="Flash Pick" products={flashSaleProducts} />
      <ProductShowcase title="Newest" products={newArrivals} />
    </>
  );
}

function SaleSpotlight({ products }: { products: StoreProduct[] }) {
  const { theme } = useStorefront();
  const isDark = theme === "dark";

  return (
    <section className="px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-to-r from-rose-600 via-red-500 to-orange-400 p-[1px] shadow-[0_28px_80px_-40px_rgba(225,29,72,0.78)]">
        <div className={`rounded-[calc(2rem-1px)] py-7 sm:py-8 ${isDark ? "bg-[#1b1018]" : "bg-[#fff7f5]"}`}>
          <div className="flex flex-wrap items-end justify-between gap-3 px-6 sm:px-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.32em] text-rose-500">Live Sale</p>
              <h2 className={`mt-2 text-2xl font-bold tracking-tight sm:text-3xl ${isDark ? "text-white" : "text-slate-950"}`}>Deals is Living</h2>
            </div>
            <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>Automatically apply sale prices at checkout</p>
          </div>

          <div className="sale-marquee mt-7 overflow-hidden px-6 sm:px-8" aria-label="Products currently on sale">
            <div className="sale-marquee-track flex w-max gap-4">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-4" aria-hidden={copy === 1}>
                  {products.map((product) => <SaleMarqueeCard key={`${copy}-${product.id}`} product={product} isDark={isDark} />)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .sale-marquee-track {
          animation: sale-marquee 24s linear infinite;
        }
        .sale-marquee:hover .sale-marquee-track {
          animation-play-state: paused;
        }
        @keyframes sale-marquee {
          to { transform: translateX(calc(-50% - 0.5rem)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .sale-marquee-track { animation: none; }
        }
      `}</style>
    </section>
  );
}

function SaleMarqueeCard({ product, isDark }: { product: StoreProduct; isDark: boolean }) {
  const discount = Math.max(0, Number(product.saleDiscountPercent ?? 0));
  const hasDiscount = product.price < product.originalPrice;
  const discountTone = getDiscountTone(discount);
  return (
    <Link href={buildProductDetailHref(product.slug)} className={`group flex w-80 shrink-0 gap-4 rounded-2xl border p-4 transition hover:-translate-y-1 ${isDark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-white bg-white shadow-sm"}`}>
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl">
        <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-110" />
        {hasDiscount ? <span className={`absolute inset-x-1 bottom-1 rounded-md px-1 py-0.5 text-center text-[10px] font-bold ${discountTone.badge}`}>-{discount}%</span> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-500">Campaign deal</p>
        <h3 className={`mt-1 truncate text-sm font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{product.name}</h3>
        {hasDiscount ? <p className="mt-2 text-xs text-slate-400 line-through">{formatCurrency(product.originalPrice)}</p> : null}
        <p className="text-sm font-bold text-rose-600">{formatCurrency(product.price)}</p>
        <SaleCountdown endsAt={product.saleEndsAt} isDark={isDark} />
      </div>
    </Link>
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
          <SectionTitle title={title} description="Products connected directly to the storefront route in this web project." />
          <Link href="/store/products" className={`rounded-full border px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-300 bg-white text-slate-950"}`}>View all</Link>
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
  const activeCategory = category ?? "All";
  const activeSort = sort ?? "newest";
  const itemsPerPage = 8;
  const [page, setPage] = useState(1);

  const filteredProducts = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return [...storeProducts]
      .filter((product) => activeCategory === "All" || product.category === activeCategory)
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
  const paginationTokens = buildPaginationTokens(safePage, totalPages);

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionTitle title="Marketplace-style product listing" description="This product page is wired directly into the current Next.js project and shows 8 products per page by default." />
        <div className={`mt-8 rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
            <label className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Search products</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Enter product name, brand, or description..." className={`h-12 rounded-2xl border px-4 text-sm outline-none ${isDark ? "border-white/10 bg-slate-900 text-white placeholder:text-slate-500" : "border-slate-200 bg-slate-50 text-slate-950 placeholder:text-slate-400"}`} />
            </label>
            <div className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Category</span>
              <div className={`h-12 rounded-2xl border px-4 text-sm leading-[46px] ${isDark ? "border-white/10 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-950"}`}>{activeCategory}</div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>Sort</span>
              <div className={`h-12 rounded-2xl border px-4 text-sm leading-[46px] ${isDark ? "border-white/10 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-950"}`}>{activeSort}</div>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>Showing <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{paginatedProducts.length}</span> / <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{filteredProducts.length}</span> products</p>
          <p className={isDark ? "text-sm text-slate-300" : "text-sm text-slate-500"}>Page <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{safePage}</span> / <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-950"}>{totalPages}</span></p>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {paginatedProducts.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1} className={`rounded-full px-5 py-3 text-sm font-semibold ${safePage <= 1 ? "cursor-not-allowed bg-slate-200 text-slate-400" : isDark ? "bg-white/5 text-white" : "bg-white text-slate-950 shadow-sm"}`}>Previous page</button>
            {paginationTokens.map((token, index) => token === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className={`px-2 text-sm font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>...</span>
            ) : (
              <button key={token} type="button" onClick={() => setPage(token)} className={`h-11 min-w-11 rounded-full px-4 text-sm font-semibold ${token === safePage ? "bg-gradient-to-r from-orange-500 to-red-500 text-white" : isDark ? "bg-white/5 text-slate-200" : "bg-white text-slate-700 shadow-sm"}`}>{token}</button>
            ))}
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages} className={`rounded-full px-5 py-3 text-sm font-semibold ${safePage >= totalPages ? "cursor-not-allowed bg-slate-200 text-slate-400" : isDark ? "bg-white/5 text-white" : "bg-white text-slate-950 shadow-sm"}`}>Next page</button>
          </div>
      </div>
    </section>
  );
}

export function ProductDetailClient({ slug }: { slug: string }) {
  const { theme, addCatalogItem } = useStorefront();
  const router = useRouter();
  const isDark = theme === "dark";
  const [quantity, setQuantity] = useState(1);
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<StoreProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [managedProduct, setManagedProduct] = useState<ManagedProduct | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    const syncSession = () => setSession(readAuthSession());
    syncSession();
    window.addEventListener(authSessionChangedEvent, syncSession);
    return () => window.removeEventListener(authSessionChangedEvent, syncSession);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      try {
        setLoadFailed(false);
        const listing = await fetchStorefrontProducts({ category: "all", limit: "240" });
        const matchedFromListing = listing.items.find((item) => item.slug === slug) ?? null;
        const productId = matchedFromListing?.id
          || slug.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)?.[0]
          || null;
        const matchedById = productId
          ? listing.items.find((item) => item.id === productId) ?? null
          : null;

        if (!productId) {
          if (!cancelled) {
            setProduct(null);
            setRelatedProducts([]);
          }
          return;
        }

        const detail = matchedFromListing
          ?? matchedById
          ?? await fetchStorefrontProductById(productId).catch(() => null);

        if (!detail) {
          if (!cancelled) {
            setProduct(null);
            setRelatedProducts([]);
            setLoadFailed(true);
          }
          return;
        }

        if (!cancelled) {
          setProduct(detail);
          if (detail.slug !== slug) {
            router.replace(buildProductDetailHref(detail.slug));
          }
          setRelatedProducts(
            listing.items.filter((item) => item.id !== detail.id && item.category === detail.category).slice(0, 4)
          );
        }
      } catch {
        if (!cancelled) {
          setProduct(null);
          setRelatedProducts([]);
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const mayManage = session && (
      session.role === "admin"
      || session.permissions.includes("products:update-own")
      || session.permissions.includes("products:delete-own")
    );
    if (!product?.id || !mayManage) {
      setManagedProduct(null);
      return;
    }

    authenticatedFetch(`${managementApiUrl}/api/shopping-items/${product.id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Cannot load product ownership (HTTP ${response.status}).`);
        return response.json() as Promise<ManagedProduct>;
      })
      .then((item) => {
        if (!cancelled) setManagedProduct(item);
      })
      .catch((error) => {
        if (!cancelled) setActionMessage(error instanceof Error ? error.message : "Cannot load product ownership.");
      });

    return () => {
      cancelled = true;
    };
  }, [product?.id, session?.accessToken]);

  if (isLoading) {
    return (
      <section className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl animate-pulse">
          <div className="grid gap-3">
            <div className={`h-4 w-40 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            <div className={`h-10 w-96 max-w-full rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            <div className={`h-4 w-72 max-w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
          </div>
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className={`overflow-hidden rounded-[2rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"}`}>
              <div className={`h-[28rem] w-full rounded-[1.75rem] sm:h-[36rem] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            </div>
            <div className={`rounded-[2rem] border p-6 sm:p-8 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"}`}>
              <div className={`h-4 w-28 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`mt-4 h-12 w-4/5 rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className="mt-5 grid gap-3">
                <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`h-4 w-11/12 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`h-4 w-3/4 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`h-10 w-28 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                ))}
              </div>
              <div className="mt-8 flex items-end gap-4">
                <div className={`h-12 w-40 rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`h-7 w-24 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className={`h-24 rounded-[1.5rem] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                ))}
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <div className={`h-14 w-36 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`h-14 w-48 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (loadFailed || !product) {
    return (
      <section className="px-4 py-10 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-3xl rounded-[2rem] border p-8 text-center ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-950 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"}`}>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-500">Product unavailable</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Product not found or has been updated
          </h1>
          <p className={`mt-4 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            The link you just opened might be pointing to an old version of the product or the product has been changed after the data was updated.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => router.replace("/store/products")}
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white"
            >
              Back to products
            </button>
            <button
              type="button"
              onClick={() => router.replace("/store")}
              className={`inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold ${isDark ? "bg-white/10 text-white" : "bg-slate-100 text-slate-900"}`}
            >
              storefront home
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!product) {
    return (
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-3xl rounded-[2rem] border p-10 text-center ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <p className="text-sm uppercase tracking-[0.3em] text-orange-500">Not found</p>
          <h1 className={`mt-4 text-3xl font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>This product does not exist in the storefront</h1>
          <Link href="/store/products" className="mt-6 inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">Back to product list</Link>
        </div>
      </section>
    );
  }

  const canAdd = product.status !== "out_of_stock" && !product.isLocked;
  const ownsProduct = Boolean(
    session
    && managedProduct
    && (session.role === "admin" || (session.subject && managedProduct.ownerSub === session.subject))
  );
  const canUpdateProduct = Boolean(
    ownsProduct
    && session
    && (session.role === "admin" || session.permissions.includes("products:update-own"))
  );
  const canDeleteProduct = Boolean(
    ownsProduct
    && session
    && (session.role === "admin" || session.permissions.includes("products:delete-own"))
  );

  function handleProductSaved(saved: ManagedProduct) {
    const storefrontProduct = toStoreProduct(saved);
    setManagedProduct(saved);
    setProduct(storefrontProduct);
    setIsEditing(false);
    setActionMessage("Product updated successfully.");
    router.replace(buildProductDetailHref(storefrontProduct.slug));
  }

  async function deleteOwnedProduct() {
    if (!managedProduct || !canDeleteProduct || !window.confirm(`Delete product "${managedProduct.name}"?`)) return;
    setDeleteBusy(true);
    setActionMessage("");
    try {
      const response = await authenticatedFetch(`${managementApiUrl}/api/shopping-items/${managedProduct.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || `Delete failed (HTTP ${response.status}).`);
      }
      router.replace("/store/products");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not delete product.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Link
          href="/store/products"
          className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold ${
            isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          Back to products
        </Link>
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
              <strong className="text-4xl font-bold text-rose-600">{formatCurrency(product.price)}</strong>
              {product.price < product.originalPrice ? <span className="pb-1 text-lg text-slate-400 line-through">{formatCurrency(product.originalPrice)}</span> : null}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <InfoTile isDark={isDark} label="Rating" value={`${product.rating} / 5`} />
              <InfoTile isDark={isDark} label="Sold" value={`${product.soldCount}+`} />
              <InfoTile isDark={isDark} label="Updated" value={formatShortDate(product.updatedAt)} />
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <div className={`inline-flex items-center rounded-full border p-1 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} className="rounded-full p-3">-</button>
                <span className="min-w-12 text-center font-semibold">{quantity}</span>
                <button type="button" onClick={() => setQuantity((current) => Math.min(product.stock || 1, current + 1))} className="rounded-full p-3">+</button>
              </div>
              <button type="button" onClick={() => addCatalogItem(product, quantity)} disabled={!canAdd} className="inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400">{product.isLocked ? "Reserved" : canAdd ? "Add to cart" : "Out of stock"}</button>
            </div>
            {canUpdateProduct || canDeleteProduct ? (
              <div id="manage-product" className={`mt-6 scroll-mt-28 rounded-3xl border p-4 ${isDark ? "border-orange-400/20 bg-orange-400/10" : "border-orange-200 bg-orange-50"}`}>
                <p className="text-sm font-semibold text-orange-700">Your product</p>
                <p className={`mt-1 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>The actions below only appear when you own this product and have the matching permission.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {canUpdateProduct ? <button type="button" onClick={() => setIsEditing((current) => !current)} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">{isEditing ? "Close update form" : "Update product"}</button> : null}
                  {canDeleteProduct ? <button type="button" onClick={() => void deleteOwnedProduct()} disabled={deleteBusy} className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{deleteBusy ? "Deleting..." : "Delete product"}</button> : null}
                </div>
              </div>
            ) : null}
            {actionMessage ? <p role="status" className="mt-4 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{actionMessage}</p> : null}
            {product.isLocked ? (
              <p className="text-sm font-medium text-amber-600">This product is temporarily reserved, so it cannot be selected right now.</p>
            ) : null}
          </div>
        </div>
        {isEditing && session && managedProduct ? (
          <div className="mt-10">
            <ProductEditor session={session} initialProduct={managedProduct} onSaved={handleProductSaved} onCancel={() => setIsEditing(false)} />
          </div>
        ) : null}
        <div className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">Related</p>
              <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>More from this category</h2>
            </div>
            <Link href="/store/products" className={`rounded-full border px-5 py-3 text-sm font-semibold ${isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-300 bg-white text-slate-950"}`}>View catalog</Link>
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
