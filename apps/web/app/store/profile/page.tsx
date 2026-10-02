"use client";
import { t, translateLabel } from "../../../src/i18n/language";
import { useLanguage } from "../../../src/i18n/LanguageProvider";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, authenticatedFetch } from "../../lib/cognito-auth";
import { useStorefront } from "../store-client";
import { buildProductDetailHref, fetchMyOrders, fetchMyProducts, toStoreProduct } from "../store-api";
import type { ManagedProduct, StoreOrder } from "../store-types";
import { formatCurrency, formatDateTime } from "../store-utils";

type ProfileMetricCardProps = {
  label: string;
  value: string;
  tone?: "warm" | "cool" | "neutral";
  isDark: boolean;
};

type DefaultAvatarItem = {
  key: string;
  fileName: string;
  fileUrl: string;
};

function ProfileMetricCard({ label, value, tone = "neutral", isDark }: ProfileMetricCardProps) {
  useLanguage();
  const toneClassName = isDark
    ? tone === "warm"
      ? "border-orange-500/20 from-orange-500/10 to-rose-500/5"
      : tone === "cool"
        ? "border-cyan-500/20 from-cyan-500/10 to-blue-500/5"
        : "border-white/10 from-white/10 to-white/5"
    : tone === "warm"
      ? "border-orange-200 from-orange-500/12 to-rose-500/12"
      : tone === "cool"
        ? "border-cyan-200 from-cyan-500/12 to-blue-500/12"
        : "border-slate-200 from-slate-200/30 to-white";

  return (
    <article className={`rounded-[1.75rem] border bg-gradient-to-br p-5 ${toneClassName}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{translateLabel(label)}</p>
      <strong className={`mt-3 block text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{value}</strong>
    </article>
  );
}

function CompactPagination({ page, totalPages, onPageChange, isDark }: { page: number; totalPages: number; onPageChange: (page: number) => void; isDark: boolean }) {
  useLanguage();
  if (totalPages <= 1) return null;
  const buttonClass = `rounded-full px-3 py-1.5 text-xs font-semibold ${isDark ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700"}`;
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40`}>{t("Previous")}</button>
      <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Page")} {page} / {totalPages}</span>
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40`}>{t("Next")}</button>
    </div>
  );
}

function ProfileSkeleton({ isDark }: { isDark: boolean }) {
  useLanguage();
  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
          <div
            className={`grid gap-8 rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] ${
              isDark ? "bg-[#101826]" : "bg-white"
            }`}
          >
            <div className="grid gap-4">
              <div className={`h-4 w-28 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-12 w-4/5 rounded-2xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className={`h-4 w-5/6 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              <div className="mt-3 flex flex-wrap gap-3">
                <div className={`h-11 w-36 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className={`h-11 w-32 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
              </div>
            </div>

            <div className={`rounded-[1.75rem] border p-5 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex items-center gap-4">
                <div className={`h-20 w-20 rounded-[1.5rem] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                <div className="grid flex-1 gap-3">
                  <div className={`h-5 w-40 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`h-4 w-28 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
              </div>
              <div className="mt-6 grid gap-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`h-12 rounded-2xl ${isDark ? "bg-white/5" : "bg-white"}`} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className={`h-32 rounded-[1.75rem] border ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`} />
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className={`rounded-[1.75rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
            <div className={`h-7 w-52 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            <div className="mt-6 grid gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-100"}`}>
                  <div className={`h-4 w-24 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-3 h-5 w-40 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-2 h-4 w-full rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
              ))}
            </div>
          </div>

          <div className={`rounded-[1.75rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
            <div className={`h-7 w-48 rounded-xl ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
            <div className="mt-6 grid gap-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={`rounded-[1.5rem] border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-slate-100"}`}>
                  <div className={`h-4 w-20 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-3 h-5 w-48 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                  <div className={`mt-2 h-4 w-5/6 rounded-full ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

type UserAddress = { ward: string; city: string; province: string };
type EditableProfile = { displayName: string; avatarKey: string; avatarUrl: string; addresses: UserAddress[] };

function makeInitials(name: string, email: string) {
  const parts = String(name || email)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "NX";
}

function addressLabel(address: UserAddress) {
  return [address.ward, address.city, address.province].filter(Boolean).join(", ");
}

function normalizeAddressDraft(addresses: UserAddress[]) {
  return addresses.map((address) => ({
    ward: address.ward.trim(),
    city: address.city.trim(),
    province: address.province.trim()
  })).filter((address) => address.ward || address.city || address.province);
}

const avatarUploadEndpoint = apiUrl("/api/uploads/avatar/presign");
const defaultAvatarsEndpoint = apiUrl("/api/uploads/default-avatars");
const profileEndpoint = apiUrl("/api/profile/me");

// Count only orders that still represent a paid purchase. Expired, cancelled,
// failed and refund-in-progress orders are excluded from these metrics.
const purchaseOrderStatuses = new Set(["paid", "completed", "done", "delivered", "fulfilled", "succeeded", "success", "refund_rejected"]);

export default function StoreProfilePage() {
  useLanguage();
  const { session, setSession, theme, openAuthModal } = useStorefront();
  const isDark = theme === "dark";
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [myProducts, setMyProducts] = useState<ManagedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [error, setError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [productsError, setProductsError] = useState("");
  const [productsPage, setProductsPage] = useState(1);
  const [ordersPage, setOrdersPage] = useState(1);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarKey, setAvatarKey] = useState("");
  const [selectedAvatarKey, setSelectedAvatarKey] = useState<string | null>(null);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [addressDraft, setAddressDraft] = useState<UserAddress[]>([]);
  const [isAddressDialogOpen, setIsAddressDialogOpen] = useState(false);
  const [isSavingAddresses, setIsSavingAddresses] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [defaultAvatars, setDefaultAvatars] = useState<DefaultAvatarItem[]>([]);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedAvatarFile) {
      setAvatarPreviewUrl("");
      return;
    }
    const previewUrl = URL.createObjectURL(selectedAvatarFile);
    setAvatarPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedAvatarFile]);

  useEffect(() => {
    let cancelled = false;

    async function loadOrders() {
      setAvatarUrl("");
      setAvatarKey("");
      setSelectedAvatarKey(null);
      setSelectedAvatarFile(null);
      setDisplayName(session?.name ?? "");
      setNameDraft(session?.name ?? "");
      setAddresses([]);
      setAddressDraft([]);
      setIsAddressDialogOpen(false);
      setIsLoading(true);
      setProductsLoading(true);

      fetch(defaultAvatarsEndpoint)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load default avatars.")))
        .then((payload: { items?: DefaultAvatarItem[] }) => {
          if (!cancelled) setDefaultAvatars(payload.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setDefaultAvatars([]);
        });

      if (!session) {
        if (!cancelled) {
          setOrders([]);
          setMyProducts([]);
          setError("");
          setProductsError("");
          setIsLoading(false);
          setProductsLoading(false);
        }
        return;
      }

      authenticatedFetch(profileEndpoint, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not load account profile.");
          return response.json() as Promise<EditableProfile>;
        })
        .then((profile) => {
          if (cancelled) return;
          setDisplayName(profile.displayName || session.name);
          setNameDraft(profile.displayName || session.name);
          setAvatarKey(profile.avatarKey);
          setAvatarUrl(profile.avatarUrl);
          setAddresses(Array.isArray(profile.addresses) ? profile.addresses : []);
          if (profile.displayName && profile.displayName !== session.name) {
            setSession({ ...session, name: profile.displayName });
          }
        })
        .catch((loadError) => {
          if (!cancelled) setProfileError(loadError instanceof Error ? loadError.message : "Could not load account profile.");
        });

      try {
        const data = await fetchMyOrders();
        if (!cancelled) {
          setOrders(data);
          setError("");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "We could not load your profile information.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    async function loadMyProducts() {
      if (!session) return;
      try {
        const items = await fetchMyProducts();
        if (!cancelled) {
          setMyProducts(items);
          setProductsError("");
        }
      } catch (nextError) {
        if (!cancelled) setProductsError(nextError instanceof Error ? nextError.message : "We could not load your products.");
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }

    void loadOrders();
    void loadMyProducts();
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken, session?.email]);

  const purchaseOrders = useMemo(() => orders.filter((order) =>
    purchaseOrderStatuses.has(String(order.status ?? "").trim().toLowerCase())
  ), [orders]);

  const stats = useMemo(() => {
    const totalOrders = purchaseOrders.length;
    const totalSpend = purchaseOrders.reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0);
    const totalItems = purchaseOrders.reduce((sum, order) => sum + order.items.reduce((inner, item) => inner + Number(item.quantity ?? 0), 0), 0);
    return {
      totalOrders,
      totalSpend,
      totalItems
    };
  }, [purchaseOrders]);

  const profileListPageSize = 5;
  const productTotalPages = Math.max(1, Math.ceil(myProducts.length / profileListPageSize));
  const orderTotalPages = Math.max(1, Math.ceil(purchaseOrders.length / profileListPageSize));
  const safeProductsPage = Math.min(productsPage, productTotalPages);
  const safeOrdersPage = Math.min(ordersPage, orderTotalPages);
  const paginatedProducts = myProducts.slice((safeProductsPage - 1) * profileListPageSize, safeProductsPage * profileListPageSize);
  const paginatedOrders = purchaseOrders.slice((safeOrdersPage - 1) * profileListPageSize, safeOrdersPage * profileListPageSize);

  useEffect(() => {
    setProductsPage((page) => Math.min(page, productTotalPages));
  }, [productTotalPages]);

  useEffect(() => {
    setOrdersPage((page) => Math.min(page, orderTotalPages));
  }, [orderTotalPages]);

  function selectAvatarFile(file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 5 * 1024 * 1024) {
      setProfileError("Please choose a JPG, PNG, or WebP image up to 5 MB.");
      return;
    }
    setSelectedAvatarFile(file);
    setSelectedAvatarKey(null);
    setProfileError("");
    setProfileNotice("");
  }

  function openAddressDialog() {
    setNameDraft(displayName || session?.name || "");
    setSelectedAvatarKey(null);
    setSelectedAvatarFile(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    setAddressDraft([addresses[0] ?? { ward: "", city: "", province: "" }]);
    setProfileError("");
    setProfileNotice("");
    setIsAddressDialogOpen(true);
  }

  function updateAddressDraft(index: number, field: keyof UserAddress, value: string) {
    setAddressDraft((current) => current.map((address, itemIndex) => itemIndex === index ? { ...address, [field]: value } : address));
  }

  async function saveAddressChanges() {
    if (!session || isSavingAddresses) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      setProfileError("Display name is required.");
      return;
    }
    const normalized = normalizeAddressDraft(addressDraft).slice(0, 1);
    if (normalized.some((address) => !address.ward || !address.city || !address.province)) {
      setProfileError("Each location must include ward, city, and province.");
      return;
    }
    setIsSavingAddresses(true);
    setProfileError("");
    setProfileNotice("");
    try {
      let nextAvatarKey = selectedAvatarKey;
      if (selectedAvatarFile) {
        const presignResponse = await authenticatedFetch(avatarUploadEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: selectedAvatarFile.name, contentType: selectedAvatarFile.type, scope: "avatars" })
        });
        const presign = await presignResponse.json().catch(() => null) as { uploadUrl?: string; key?: string; message?: string } | null;
        if (!presignResponse.ok || !presign?.uploadUrl || !presign.key) {
          throw new Error(presign?.message || "Could not prepare avatar upload.");
        }
        const uploadResponse = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": selectedAvatarFile.type },
          body: selectedAvatarFile
        });
        if (!uploadResponse.ok) throw new Error("Could not upload avatar to S3.");
        nextAvatarKey = presign.key;
      }
      const response = await authenticatedFetch(profileEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: nextName,
          ...(nextAvatarKey !== null ? { avatarKey: nextAvatarKey } : {}),
          addresses: normalized
        })
      });
      const result = await response.json().catch(() => null) as (EditableProfile & { message?: string }) | null;
      if (!response.ok || !result) throw new Error(result?.message || "Could not save profile information.");
      setDisplayName(result.displayName);
      setNameDraft(result.displayName);
      setAvatarKey(result.avatarKey);
      setAvatarUrl(result.avatarUrl);
      setAddresses(Array.isArray(result.addresses) ? result.addresses : []);
      setAddressDraft([]);
      setSelectedAvatarKey(null);
      setSelectedAvatarFile(null);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      if (result.displayName && session.name !== result.displayName) {
        setSession({ ...session, name: result.displayName });
      }
      setIsAddressDialogOpen(false);
      setProfileNotice("Profile information saved.");
    } catch (saveError) {
      setProfileError(saveError instanceof Error ? saveError.message : "Could not save profile information.");
    } finally {
      setIsSavingAddresses(false);
    }
  }

  if (isLoading) {
    return <ProfileSkeleton isDark={isDark} />;
  }

  if (!session) {
    return (
      <main className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
          <div className={`rounded-[calc(2rem-1px)] px-6 py-10 text-center sm:px-8 ${isDark ? "bg-[#101826] text-white" : "bg-white text-slate-950"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">{t("Personal Profile")}</p>
            <h1 className={`mt-4 text-4xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{t("Sign in to open your profile")}</h1>
            <p className={`mx-auto mt-4 max-w-2xl text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t("When you sign in, you can view your account details, spending summary, and recent orders directly in the storefront.")}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => openAuthModal("/store/profile")} className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">{t("Sign in now")}</button>
              <Link
                href="/store/products"
                className={`rounded-full px-5 py-3 text-sm font-semibold ${
                  isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
                }`}
              >{t("Browse products first")}</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const initials = makeInitials(displayName || session.name, session.email);
  const selectedDefaultAvatar = defaultAvatars.find((avatar) => avatar.key === selectedAvatarKey);
  const displayedAvatarUrl = avatarPreviewUrl || selectedDefaultAvatar?.fileUrl || avatarUrl;
  return (
    <main className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
          <div
            className={`grid gap-8 rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] ${
              isDark ? "bg-[#101826] text-white" : "bg-white text-slate-950"
            }`}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">{t("Your Profile")}</p>
              <h1 className={`mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl ${isDark ? "text-white" : "text-slate-950"}`}>
                {displayName || session.name || t("NovaX user")}{t(", welcome back!")}</h1>
              <p className={`mt-5 max-w-2xl text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t("View your account information, purchase history, and spending summary.")}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/store/orders" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">{t("View Order History")}</Link>
                <Link
                  href="/store/products"
                  className={`rounded-full px-5 py-3 text-sm font-semibold ${
                    isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
                  }`}
                >{t("Continue Shopping")}</Link>
              </div>
            </div>

            <aside
              className={`rounded-[1.75rem] border p-5 shadow-[0_24px_80px_-64px_rgba(15,23,42,0.4)] ${
                isDark
                  ? "border-white/10 bg-[linear-gradient(180deg,_rgba(15,23,42,0.96)_0%,_rgba(30,41,59,0.9)_100%)]"
                  : "border-slate-200 bg-[linear-gradient(180deg,_rgba(248,250,252,1)_0%,_rgba(255,247,237,0.92)_100%)]"
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <div className="h-28 w-28 overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-orange-500 to-pink-500 text-3xl font-bold tracking-[0.18em] text-white shadow-[0_18px_40px_-22px_rgba(249,115,22,0.85)]">
                    {displayedAvatarUrl ? <img src={displayedAvatarUrl} alt={t("Avatar")} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center">{initials}</div>}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{displayName || session.name}</p>
                  <p className={`truncate text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>{session.email}</p>
                  <span
                    className={`mt-2 inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                      session.role === "admin"
                        ? isDark
                          ? "bg-cyan-500/15 text-cyan-300"
                          : "bg-cyan-100 text-cyan-700"
                        : isDark
                          ? "bg-orange-500/15 text-orange-300"
                          : "bg-orange-100 text-orange-700"
                    }`}
                  >
                    {session.role === "admin" ? t("Admin") : t("Customer")}
                  </span>
                </div>
                <button type="button" onClick={openAddressDialog} disabled={isSavingAddresses} className="shrink-0 rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t("Change information")}</button>
              </div>
              {profileError ? <p role="alert" className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{translateLabel(profileError)}</p> : null}
              {profileNotice ? <p role="status" className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{translateLabel(profileNotice)}</p> : null}

              <div className="mt-6 grid gap-3">
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Sign-in method")}</p>
                  <p className={`mt-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>{t("Sign-in session")}</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Current Session")}</p>
                  <p className={`mt-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>{t("Expires at")} {formatDateTime(new Date(session.expiresAt).toISOString())}</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Status")}</p>
                  <p className={`mt-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>{t("Active and ready to place orders")}</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Product Permissions")}</p>
                  <p className={`mt-1 break-words text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>{session.permissions.length > 0 ? session.permissions.join(", ") : t("No delegated product permissions")}</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/80"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Location")}</p>
                  </div>
                  <div className={`mt-2 space-y-1 text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>
                    {addresses.length ? addresses.map((address, index) => <p key={`${address.ward}:${address.city}:${address.province}:${index}`} className="break-words">{index + 1}. {addressLabel(address)}</p>) : <p>{t("No saved location")}</p>}
                  </div>
                </div>
              </div>
              {isAddressDialogOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
                  <form onSubmit={(event) => { event.preventDefault(); void saveAddressChanges(); }} className={`w-full max-w-2xl rounded-2xl p-5 shadow-xl ${isDark ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-500">{t("Change Information")}</p>
                        <h3 className="mt-1 text-xl font-semibold">{t("Profile information")}</h3>
                      </div>
                      <button type="button" onClick={() => setIsAddressDialogOpen(false)} disabled={isSavingAddresses} className={`rounded-xl px-3 py-2 text-sm font-semibold ${isDark ? "border border-white/10 text-white" : "border border-slate-200 text-slate-700"} disabled:opacity-50`}>{t("Close")}</button>
                    </div>
                    <div className="mt-5 grid gap-4">
                      <div className={`rounded-2xl border p-3 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                        <p className="mb-3 text-sm font-semibold">{t("Basic information")}</p>
                        <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
                          <div className="flex flex-col items-center gap-2">
                            <div className="h-24 w-24 overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-slate-950 via-orange-500 to-pink-500 text-2xl font-bold tracking-[0.18em] text-white">
                              {avatarPreviewUrl || selectedDefaultAvatar?.fileUrl || avatarUrl ? <img src={avatarPreviewUrl || selectedDefaultAvatar?.fileUrl || avatarUrl} alt={t("Avatar preview")} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center">{initials}</div>}
                            </div>
                            <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={isSavingAddresses} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${isDark ? "bg-white/10 text-white" : "bg-slate-900 text-white"} disabled:opacity-60`}>{t("Choose photo")}</button>
                            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => selectAvatarFile(event.target.files?.[0])} />
                          </div>
                          <div className="grid gap-3">
                            <label className="grid gap-1 text-xs font-semibold">{t("Display name")}<input value={nameDraft} onChange={(event) => { setNameDraft(event.target.value); setProfileNotice(""); }} maxLength={80} required disabled={isSavingAddresses} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 disabled:opacity-60" /></label>
                            {defaultAvatars.length > 0 ? (
                              <div>
                                <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Default Avatars")}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {defaultAvatars.map((avatar) => (
                                    <button key={avatar.key} type="button" onClick={() => { setSelectedAvatarKey(avatar.key); setSelectedAvatarFile(null); setProfileError(""); setProfileNotice(""); }} disabled={isSavingAddresses} className={`h-11 w-11 overflow-hidden rounded-2xl border transition ${(selectedAvatarKey ?? avatarKey) === avatar.key && !selectedAvatarFile ? "border-orange-500 ring-2 ring-orange-300" : isDark ? "border-white/10 hover:border-white/30" : "border-slate-200 hover:border-orange-300"}`} title={avatar.fileName}>
                                      <img src={avatar.fileUrl} alt={avatar.fileName} className="h-full w-full object-cover" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className={`rounded-2xl border p-3 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                        <p className="mb-3 text-sm font-semibold">{t("Location")}</p>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="grid gap-1 text-xs font-semibold">{t("Ward")}<input value={addressDraft[0]?.ward ?? ""} onChange={(event) => updateAddressDraft(0, "ward", event.target.value)} disabled={isSavingAddresses} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 disabled:opacity-60" /></label>
                          <label className="grid gap-1 text-xs font-semibold">{t("City")}<input value={addressDraft[0]?.city ?? ""} onChange={(event) => updateAddressDraft(0, "city", event.target.value)} disabled={isSavingAddresses} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 disabled:opacity-60" /></label>
                          <label className="grid gap-1 text-xs font-semibold">{t("Province")}<input value={addressDraft[0]?.province ?? ""} onChange={(event) => updateAddressDraft(0, "province", event.target.value)} disabled={isSavingAddresses} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 disabled:opacity-60" /></label>
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
                      <button type="button" onClick={() => setIsAddressDialogOpen(false)} disabled={isSavingAddresses} className={`rounded-xl px-4 py-2 text-sm font-semibold ${isDark ? "border border-white/10 text-white" : "border border-slate-200 text-slate-700"} disabled:opacity-50`}>{t("Cancel")}</button>
                      <button type="submit" disabled={isSavingAddresses} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSavingAddresses ? t("Saving...") : t("Save information")}</button>
                    </div>
                  </form>
                </div>
              ) : null}
            </aside>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <ProfileMetricCard label={t("Paid Orders")} value={String(stats.totalOrders)} tone="warm" isDark={isDark} />
          <ProfileMetricCard label={t("Total Spent")} value={formatCurrency(stats.totalSpend)} tone="cool" isDark={isDark} />
          <ProfileMetricCard label={t("Total Products Purchased")} value={String(stats.totalItems)} tone="neutral" isDark={isDark} />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <section id="my-products" className={`scroll-mt-28 rounded-[1.75rem] border p-6 shadow-[0_24px_80px_-60px_rgba(15,23,42,0.24)] ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">{t("My Products")}</p>
              <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{t("Your Products")}</h2>
              <p className={`mt-2 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>{t("This list is filtered by the owner of the current account.")}</p>
            </div>
            {session.role === "admin" || session.permissions.includes("products:create") ? (
            <Link href="/store/products?add=1" className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">{t("+ Add Product")}</Link>
            ) : null}
          </div>

          {productsLoading ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className={`h-48 animate-pulse rounded-3xl ${isDark ? "bg-white/10" : "bg-slate-100"}`} />)}</div>
          ) : productsError ? (
            <p role="alert" className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{translateLabel(productsError)}</p>
          ) : myProducts.length === 0 ? (
            <div className={`mt-6 rounded-3xl border border-dashed px-6 py-10 text-center ${isDark ? "border-white/10 text-slate-300" : "border-slate-200 text-slate-600"}`}>
              <p>{t("You have not created any products yet.")}</p>
              {session.role === "admin" || session.permissions.includes("products:create") ? <Link href="/store/products?add=1" className="mt-4 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">{t("Create your first product")}</Link> : null}
            </div>
          ) : (<>
            <div className="mt-6 grid gap-3">
              {paginatedProducts.map((item) => {
                const storefrontProduct = toStoreProduct(item);
                return (
                  <article key={item.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                    <img src={storefrontProduct.imageUrl} alt={item.name} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-orange-500">{translateLabel(item.category)}</p>
                      <h3 className={`truncate text-base font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{item.name}</h3>
                      <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("Stock")} {item.stock} / {formatCurrency(item.price)}</p>
                    </div>
                    <Link href={buildProductDetailHref(storefrontProduct.slug)} className="shrink-0 rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white">{t("View")}</Link>
                  </article>
                );
              })}
            </div>
            <CompactPagination page={safeProductsPage} totalPages={productTotalPages} onPageChange={setProductsPage} isDark={isDark} />
          </>)}
        </section>

        <section className={`rounded-[1.75rem] border p-6 shadow-[0_24px_80px_-60px_rgba(15,23,42,0.24)] ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">{t("Recent Orders")}</p>
                <h2 className={`mt-3 text-3xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{t("Latest Purchase Activity")}</h2>
              </div>
              <Link
                href="/store/orders"
                className={`rounded-full px-5 py-3 text-sm font-semibold ${
                  isDark ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 text-slate-700"
                }`}
              >{t("View Order History")}</Link>
            </div>

            {error ? (
              <div className={`mt-6 rounded-[1.5rem] border px-4 py-4 text-sm ${isDark ? "border-rose-500/20 bg-rose-500/10 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                {translateLabel(error)}
              </div>
            ) : paginatedOrders.length === 0 ? (
              <div
                className={`mt-6 rounded-[1.5rem] border border-dashed px-4 py-8 text-sm ${
                  isDark ? "border-white/10 bg-white/5 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >{t("You have not placed any orders yet.")}</div>
            ) : (<>
              <div className="mt-6 grid gap-3">
                {paginatedOrders.map((order) => (
                  <article
                    key={order.id}
                    className={`rounded-2xl border px-3 py-3 ${
                      isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">{t("Order ID")} {order.id.slice(0, 8)}</p>
                        <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>{order.items.length} {t("items /")} {formatDateTime(order.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{formatCurrency(order.totalAmount)}</p>
                        <p className={`mt-1 text-xs uppercase tracking-[0.18em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{translateLabel(order.status)}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <CompactPagination page={safeOrdersPage} totalPages={orderTotalPages} onPageChange={setOrdersPage} isDark={isDark} />
            </>)}
          </section>
        </section>
      </div>
    </main>
  );
}
